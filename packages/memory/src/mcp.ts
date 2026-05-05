import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  EffectiveMcpConfigSchema,
  McpDoctorResultSchema,
  McpAddServerSchema,
  McpConfigFileSchema,
  McpDeleteServerSchema,
  McpEditableScopeSchema,
  McpPatchServerSchema,
  McpServerStatusSnapshotSchema,
  McpServerConfigSchema,
  createTraceId,
  nowIso,
  type EffectiveMcpConfig,
  type McpAddServerInput,
  type McpConfigFile,
  type McpDeleteServerInput,
  type McpEditableScope,
  type McpPatchServerInput,
  type McpScope,
  type McpDoctorResult,
  type McpServerConfig,
  type McpServerOrigin,
  type McpServerStatusSnapshot
} from "@ward/core";
import type { Database } from "bun:sqlite";
import { ensureWardLayout, resolveRepoRoot, resolveWardPaths, type WardPaths } from "./layout.ts";
import { openWardDatabase } from "./migrations.ts";
import { probeStdioMcpServer } from "./mcp-client.ts";
import { resolveSecretString } from "./secrets.ts";

type WorkspaceMcpRow = {
  id: number;
  slug: string;
  primary_repo_path: string | null;
};

type WorkspaceRepoMcpRow = {
  id: number;
  local_path: string;
  is_primary: number;
};

type McpServerStatusRow = {
  server_id: string;
  workspace_id: number | null;
  workspace_slug: string | null;
  scope: McpScope;
  origin_path: string;
  transport: "stdio" | "http";
  enabled: number;
  status: "ok" | "error" | "disabled" | "unsupported";
  tool_count: number;
  tools_json: string;
  error: string | null;
  stderr_log_path: string | null;
  checked_at: string;
  duration_ms: number;
  trace_id: string;
};

type McpLayer = {
  origin: McpServerOrigin;
  config: McpConfigFile;
};

type EffectiveMcpOptions = {
  includeRepo?: boolean;
  redact?: boolean;
};

type SessionOverlayWardOptions = {
  allowed_tools: string[];
  autonomy_level: string;
  incognito: boolean;
  timeouts: {
    wall_clock_max_ms: number;
    idle_max_ms: number;
  };
  generated_at: string;
};

function emptyConfig(): McpConfigFile {
  return McpConfigFileSchema.parse({ mcpServers: {} });
}

function withDb<T>(fn: (db: Database, paths: WardPaths) => T): T {
  const paths = resolveWardPaths();
  const db = openWardDatabase(paths);
  try {
    return fn(db, paths);
  } finally {
    db.close();
  }
}

function workspaceByRef(db: Database, ref: string | number): WorkspaceMcpRow | null {
  return db.query<WorkspaceMcpRow, [string, string]>(`
    SELECT id, slug, primary_repo_path
    FROM workspace
    WHERE slug = ? OR CAST(id AS TEXT) = ?
  `).get(String(ref), String(ref)) ?? null;
}

function requireWorkspace(db: Database, ref: string | number | undefined): WorkspaceMcpRow {
  if (!ref) {
    throw new Error("Workspace is required for workspace/repo MCP scope");
  }
  const workspace = workspaceByRef(db, ref);
  if (!workspace) {
    throw new Error("Workspace not found");
  }
  return workspace;
}

function workspaceConfigPath(paths: WardPaths, workspaceSlug: string): string {
  return join(paths.workspacesDir, workspaceSlug, "mcp.json");
}

function globalConfigPath(paths: WardPaths): string {
  return join(paths.home, "mcp.json");
}

function primaryRepoPath(db: Database, workspace: WorkspaceMcpRow): string | null {
  const primary = db.query<WorkspaceRepoMcpRow, [number]>(`
    SELECT id, local_path, is_primary
    FROM workspace_repo
    WHERE workspace_id = ?
    ORDER BY is_primary DESC, id ASC
    LIMIT 1
  `).get(workspace.id);
  return primary?.local_path ?? workspace.primary_repo_path;
}

function repoRows(db: Database, workspace: WorkspaceMcpRow): WorkspaceRepoMcpRow[] {
  const rows = db.query<WorkspaceRepoMcpRow, [number]>(`
    SELECT id, local_path, is_primary
    FROM workspace_repo
    WHERE workspace_id = ?
    ORDER BY is_primary ASC, id ASC
  `).all(workspace.id);
  if (workspace.primary_repo_path && !rows.some((row) => row.local_path === workspace.primary_repo_path)) {
    rows.push({ id: 0, local_path: workspace.primary_repo_path, is_primary: 1 });
  }
  return rows;
}

async function readMcpConfigFile(path: string): Promise<McpConfigFile> {
  try {
    const raw = await readFile(path, "utf8");
    return McpConfigFileSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return emptyConfig();
    }
    throw error;
  }
}

async function writeMcpConfigFile(path: string, config: McpConfigFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const parsed = McpConfigFileSchema.parse(config);
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

function sensitiveKey(key: string): boolean {
  return /token|secret|password|api[_-]?key|authorization|auth/i.test(key);
}

function redactValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (value.startsWith("secret://")) {
      return value;
    }
    return sensitiveKey(key) ? "[redacted]" : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, entryKey)
    ]));
  }
  return value;
}

function redactServerConfig(config: McpServerConfig): McpServerConfig {
  return McpServerConfigSchema.parse(redactValue(config));
}

function redactConfigFile(config: McpConfigFile): McpConfigFile {
  return McpConfigFileSchema.parse({
    ...config,
    mcpServers: Object.fromEntries(Object.entries(config.mcpServers).map(([serverId, serverConfig]) => [
      serverId,
      redactServerConfig(McpServerConfigSchema.parse(serverConfig))
    ]))
  });
}

function safeLogName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function mcpLogPath(paths: WardPaths, serverId: string): string {
  return join(paths.logsDir, "mcp", `${safeLogName(serverId)}.log`);
}

function redactionValues(config: McpServerConfig): string[] {
  return [...Object.values(config.env), ...Object.values(config.headers)]
    .filter((value) => value && !value.startsWith("secret://"));
}

function statusFromRow(row: McpServerStatusRow): McpServerStatusSnapshot {
  return McpServerStatusSnapshotSchema.parse({
    server_id: row.server_id,
    workspace_id: row.workspace_id,
    workspace_slug: row.workspace_slug,
    scope: row.scope,
    origin_path: row.origin_path,
    transport: row.transport,
    enabled: Boolean(row.enabled),
    status: row.status,
    tool_count: row.tool_count,
    tools: JSON.parse(row.tools_json),
    error: row.error,
    stderr_log_path: row.stderr_log_path,
    checked_at: row.checked_at,
    duration_ms: row.duration_ms,
    trace_id: row.trace_id
  });
}

function conflictReason(winner: McpServerOrigin, shadowed: McpServerOrigin): string {
  if (winner.scope === shadowed.scope && winner.scope === "repo") {
    return "primary repo wins over another linked repo";
  }
  return `${winner.scope} scope overrides ${shadowed.scope} scope`;
}

async function resolveSecretRecord(values: Record<string, string>, origin: McpServerOrigin): Promise<Record<string, string>> {
  const selector = origin.scope === "global"
    ? { scope: "global" as const }
    : { scope: "workspace" as const, workspace: origin.workspace_slug };
  return Object.fromEntries(await Promise.all(Object.entries(values).map(async ([key, value]) => [
    key,
    await resolveSecretString(value, selector)
  ])));
}

async function resolveMcpServerSecrets(config: McpServerConfig, origin: McpServerOrigin): Promise<McpServerConfig> {
  return McpServerConfigSchema.parse({
    ...config,
    env: await resolveSecretRecord(config.env, origin),
    headers: await resolveSecretRecord(config.headers, origin)
  });
}

function mergeLayers(layers: McpLayer[], redact: boolean): EffectiveMcpConfig["servers"] {
  const servers = new Map<string, EffectiveMcpConfig["servers"][number]>();
  for (const layer of layers) {
    for (const [serverId, serverConfig] of Object.entries(layer.config.mcpServers)) {
      const config = McpServerConfigSchema.parse(serverConfig);
      const existing = servers.get(serverId);
      if (!existing) {
        servers.set(serverId, {
          id: serverId,
          origin: layer.origin,
          config: redact ? redactServerConfig(config) : config,
          conflicts: []
        });
        continue;
      }
      const conflict = {
        server_id: serverId,
        winner: layer.origin,
        shadowed: existing.origin,
        reason: conflictReason(layer.origin, existing.origin)
      };
      servers.set(serverId, {
        id: serverId,
        origin: layer.origin,
        config: redact ? redactServerConfig(config) : config,
        conflicts: [...existing.conflicts, conflict]
      });
    }
  }
  return [...servers.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function scopedConfigPath(scope: McpEditableScope, workspaceRef?: string): Promise<{ path: string; workspace: WorkspaceMcpRow | null }> {
  const paths = resolveWardPaths();
  await ensureWardLayout(paths);
  if (scope === "global") {
    return { path: globalConfigPath(paths), workspace: null };
  }
  return withDb((db) => {
    const workspace = requireWorkspace(db, workspaceRef);
    return { path: workspaceConfigPath(paths, workspace.slug), workspace };
  });
}

export async function getEffectiveMcpConfig(workspaceRef?: string | number, options: EffectiveMcpOptions = {}): Promise<EffectiveMcpConfig> {
  const includeRepo = options.includeRepo ?? true;
  const redact = options.redact ?? true;
  const paths = resolveWardPaths();
  await ensureWardLayout(paths);
  const workspace = workspaceRef === undefined ? null : withDb((db) => {
    const found = workspaceByRef(db, workspaceRef);
    if (!found) {
      throw new Error("Workspace not found");
    }
    return found;
  });
  const layers: McpLayer[] = [
    {
      origin: { scope: "global", path: globalConfigPath(paths) },
      config: await readMcpConfigFile(globalConfigPath(paths))
    }
  ];
  if (workspace) {
    const workspacePath = workspaceConfigPath(paths, workspace.slug);
    layers.push({
      origin: { scope: "workspace", path: workspacePath, workspace_slug: workspace.slug },
      config: await readMcpConfigFile(workspacePath)
    });
    if (includeRepo) {
      const repos = withDb((db) => repoRows(db, workspace));
      for (const repo of repos) {
        const repoConfigPath = join(repo.local_path, ".mcp.json");
        layers.push({
          origin: {
            scope: "repo",
            path: repoConfigPath,
            workspace_slug: workspace.slug,
            repo_path: repo.local_path,
            primary_repo: Boolean(repo.is_primary)
          },
          config: await readMcpConfigFile(repoConfigPath)
        });
      }
    }
  }
  const servers = mergeLayers(layers, redact);
  return EffectiveMcpConfigSchema.parse({
    workspace_id: workspace?.id ?? null,
    workspace_slug: workspace?.slug ?? null,
    include_repo: includeRepo,
    generated_at: nowIso(),
    servers,
    conflicts: servers.flatMap((server) => server.conflicts)
  });
}

export async function listMcpScopeServers(scope: McpScope, workspaceRef?: string): Promise<{
  scope: McpScope;
  workspace: string | null;
  path: string;
  config: McpConfigFile;
}> {
  const paths = resolveWardPaths();
  await ensureWardLayout(paths);
  if (scope === "global") {
    const path = globalConfigPath(paths);
    return { scope, workspace: null, path, config: redactConfigFile(await readMcpConfigFile(path)) };
  }
  return withDb(async (db) => {
    const workspace = requireWorkspace(db, workspaceRef);
    const path = scope === "workspace"
      ? workspaceConfigPath(paths, workspace.slug)
      : join(primaryRepoPath(db, workspace) ?? "", ".mcp.json");
    if (scope === "repo" && !primaryRepoPath(db, workspace)) {
      throw new Error("Workspace has no linked repo for repo MCP scope");
    }
    return {
      scope,
      workspace: workspace.slug,
      path,
      config: redactConfigFile(await readMcpConfigFile(path))
    };
  });
}

export async function addMcpServer(input: McpAddServerInput): Promise<{
  id: string;
  scope: McpEditableScope;
  workspace: string | null;
  path: string;
  config: McpServerConfig;
}> {
  const parsed = McpAddServerSchema.parse(input);
  const target = await scopedConfigPath(parsed.scope, parsed.workspace);
  const config = await readMcpConfigFile(target.path);
  config.mcpServers[parsed.id] = parsed.config;
  await writeMcpConfigFile(target.path, config);
  return {
    id: parsed.id,
    scope: parsed.scope,
    workspace: target.workspace?.slug ?? null,
    path: target.path,
    config: redactServerConfig(parsed.config)
  };
}

export async function patchMcpServer(id: string, input: McpPatchServerInput): Promise<{
  id: string;
  scope: McpEditableScope;
  workspace: string | null;
  path: string;
  config: McpServerConfig;
}> {
  const parsed = McpPatchServerSchema.parse(input);
  const target = await scopedConfigPath(parsed.scope, parsed.workspace);
  const config = await readMcpConfigFile(target.path);
  const current = config.mcpServers[id];
  if (!current) {
    throw new Error("MCP server not found");
  }
  const next = McpServerConfigSchema.parse({ ...current, ...parsed.patch });
  config.mcpServers[id] = next;
  await writeMcpConfigFile(target.path, config);
  return {
    id,
    scope: parsed.scope,
    workspace: target.workspace?.slug ?? null,
    path: target.path,
    config: redactServerConfig(next)
  };
}

export async function deleteMcpServer(id: string, input: McpDeleteServerInput): Promise<{
  id: string;
  scope: McpEditableScope;
  workspace: string | null;
  path: string;
  deleted: boolean;
}> {
  const parsed = McpDeleteServerSchema.parse(input);
  const target = await scopedConfigPath(parsed.scope, parsed.workspace);
  const config = await readMcpConfigFile(target.path);
  const deleted = Boolean(config.mcpServers[id]);
  delete config.mcpServers[id];
  await writeMcpConfigFile(target.path, config);
  return {
    id,
    scope: parsed.scope,
    workspace: target.workspace?.slug ?? null,
    path: target.path,
    deleted
  };
}

function insertMcpServerStatus(db: Database, snapshot: McpServerStatusSnapshot): void {
  db.query(`
    INSERT INTO mcp_server_status (
      server_id,
      workspace_id,
      workspace_slug,
      scope,
      origin_path,
      transport,
      enabled,
      status,
      tool_count,
      tools_json,
      error,
      stderr_log_path,
      checked_at,
      duration_ms,
      trace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.server_id,
    snapshot.workspace_id,
    snapshot.workspace_slug,
    snapshot.scope,
    snapshot.origin_path,
    snapshot.transport,
    snapshot.enabled ? 1 : 0,
    snapshot.status,
    snapshot.tool_count,
    JSON.stringify(snapshot.tools),
    snapshot.error,
    snapshot.stderr_log_path,
    snapshot.checked_at,
    snapshot.duration_ms,
    snapshot.trace_id
  );
}

export function listMcpServerStatuses(workspaceRef?: string | number): McpServerStatusSnapshot[] {
  return withDb((db) => {
    const workspace = workspaceRef === undefined ? null : workspaceByRef(db, workspaceRef);
    if (workspaceRef !== undefined && !workspace) {
      throw new Error("Workspace not found");
    }
    const rows = workspace
      ? db.query<McpServerStatusRow, [number]>(`
          SELECT
            server_id,
            workspace_id,
            workspace_slug,
            scope,
            origin_path,
            transport,
            enabled,
            status,
            tool_count,
            tools_json,
            error,
            stderr_log_path,
            checked_at,
            duration_ms,
            trace_id
          FROM mcp_server_status
          WHERE id IN (
            SELECT MAX(id)
            FROM mcp_server_status
            WHERE workspace_id = ?
            GROUP BY server_id, COALESCE(workspace_id, 0)
          )
          ORDER BY server_id ASC
        `).all(workspace.id)
      : db.query<McpServerStatusRow, []>(`
          SELECT
            server_id,
            workspace_id,
            workspace_slug,
            scope,
            origin_path,
            transport,
            enabled,
            status,
            tool_count,
            tools_json,
            error,
            stderr_log_path,
            checked_at,
            duration_ms,
            trace_id
          FROM mcp_server_status
          WHERE id IN (
            SELECT MAX(id)
            FROM mcp_server_status
            GROUP BY server_id, COALESCE(workspace_id, 0)
          )
          ORDER BY workspace_slug ASC, server_id ASC
        `).all();
    return rows.map(statusFromRow);
  });
}

export async function runMcpDoctor(input: {
  workspace?: string | number;
  timeout_ms?: number;
} = {}): Promise<McpDoctorResult> {
  const paths = resolveWardPaths();
  await ensureWardLayout(paths);
  const effective = await getEffectiveMcpConfig(input.workspace, { includeRepo: true, redact: false });
  const db = openWardDatabase(paths);
  const checks: McpServerStatusSnapshot[] = [];
  try {
    for (const server of effective.servers) {
      const started = Date.now();
      const traceId = createTraceId("mcp_doctor");
      const base = {
        server_id: server.id,
        workspace_id: effective.workspace_id,
        workspace_slug: effective.workspace_slug,
        scope: server.origin.scope,
        origin_path: server.origin.path,
        transport: server.config.transport,
        enabled: server.config.ward_enabled !== false,
        checked_at: nowIso(),
        trace_id: traceId
      };

      let snapshot: McpServerStatusSnapshot;
      if (server.config.ward_enabled === false) {
        snapshot = McpServerStatusSnapshotSchema.parse({
          ...base,
          status: "disabled",
          tool_count: 0,
          tools: [],
          error: null,
          stderr_log_path: null,
          duration_ms: Date.now() - started
        });
      } else if (server.config.transport !== "stdio") {
        snapshot = McpServerStatusSnapshotSchema.parse({
          ...base,
          status: "unsupported",
          tool_count: 0,
          tools: [],
          error: "HTTP MCP lifecycle checks are deferred.",
          stderr_log_path: null,
          duration_ms: Date.now() - started
        });
      } else {
        const resolved = await resolveMcpServerSecrets(server.config, server.origin);
        const stderrLogPath = mcpLogPath(paths, server.id);
        try {
          const probe = await probeStdioMcpServer({
            command: resolved.command!,
            args: resolved.args,
            env: resolved.env,
            cwd: server.origin.repo_path ?? resolveRepoRoot(),
            timeout_ms: input.timeout_ms,
            stderr_log_path: stderrLogPath,
            redaction_values: redactionValues(resolved)
          });
          snapshot = McpServerStatusSnapshotSchema.parse({
            ...base,
            status: "ok",
            tool_count: probe.tools.length,
            tools: probe.tools,
            error: null,
            stderr_log_path: probe.stderr_log_path,
            duration_ms: Date.now() - started
          });
        } catch (error) {
          snapshot = McpServerStatusSnapshotSchema.parse({
            ...base,
            status: "error",
            tool_count: 0,
            tools: [],
            error: error instanceof Error ? error.message : String(error),
            stderr_log_path: stderrLogPath,
            duration_ms: Date.now() - started
          });
        }
      }
      insertMcpServerStatus(db, snapshot);
      checks.push(snapshot);
    }
  } finally {
    db.close();
  }

  const failed = checks.filter((check) => check.status === "error").length;
  const passed = checks.filter((check) => check.status === "ok").length;
  const skipped = checks.length - passed - failed;
  return McpDoctorResultSchema.parse({
    ok: failed === 0,
    workspace_id: effective.workspace_id,
    workspace_slug: effective.workspace_slug,
    generated_at: nowIso(),
    checks,
    summary: {
      total: checks.length,
      passed,
      failed,
      skipped
    }
  });
}

export async function buildMcpSessionOverlay(workspaceSlug: string, ward: SessionOverlayWardOptions): Promise<{
  mcpServers: Record<string, McpServerConfig>;
  ward: SessionOverlayWardOptions;
}> {
  const effective = await getEffectiveMcpConfig(workspaceSlug, { includeRepo: false, redact: false });
  const enabledServers = effective.servers.filter((server) => server.config.ward_enabled !== false);
  return {
    mcpServers: Object.fromEntries(await Promise.all(enabledServers.map(async (server) => [
      server.id,
      await resolveMcpServerSecrets(server.config, server.origin)
    ]))),
    ward
  };
}
