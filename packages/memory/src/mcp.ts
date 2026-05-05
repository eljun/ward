import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  EffectiveMcpConfigSchema,
  McpAddServerSchema,
  McpConfigFileSchema,
  McpDeleteServerSchema,
  McpEditableScopeSchema,
  McpPatchServerSchema,
  McpServerConfigSchema,
  nowIso,
  type EffectiveMcpConfig,
  type McpAddServerInput,
  type McpConfigFile,
  type McpDeleteServerInput,
  type McpEditableScope,
  type McpPatchServerInput,
  type McpScope,
  type McpServerConfig,
  type McpServerOrigin
} from "@ward/core";
import type { Database } from "bun:sqlite";
import { ensureWardLayout, resolveWardPaths, type WardPaths } from "./layout.ts";
import { openWardDatabase } from "./migrations.ts";
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
