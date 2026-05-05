import { join } from "node:path";
import {
  McpBreakerStatusSchema,
  McpSyntheticUnavailableResultSchema,
  McpToolCallRequestSchema,
  McpToolCallResultSchema,
  createEvent,
  createTraceId,
  nowIso,
  type McpBreakerStatus,
  type McpServerConfig,
  type McpServerOrigin,
  type McpToolCallRequest,
  type McpToolCallResult,
  type WardEvent
} from "@ward/core";
import type { Database } from "bun:sqlite";
import { ensureWardLayout, resolveRepoRoot, resolveWardPaths, type WardPaths } from "./layout.ts";
import { openWardDatabase } from "./migrations.ts";
import { callStdioMcpTool } from "./mcp-client.ts";
import { getEffectiveMcpConfig } from "./mcp.ts";
import { evaluateMcpPolicy } from "./mcp-policy.ts";
import { resolveSecretString } from "./secrets.ts";

const BREAKER_WINDOW_MS = Number(process.env.WARD_MCP_BREAKER_WINDOW_MS ?? "60000");
const BREAKER_THRESHOLD = Number(process.env.WARD_MCP_BREAKER_THRESHOLD ?? "3");
const BREAKER_FREEZE_MS = Number(process.env.WARD_MCP_BREAKER_FREEZE_MS ?? "30000");

type QuotaBreakerRow = {
  amount: number;
  window_start: string;
  created_at: string;
};

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function safeLogName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function mcpLogPath(paths: WardPaths, serverId: string): string {
  return join(paths.logsDir, "mcp", `${safeLogName(serverId)}.log`);
}

function sensitiveKey(key: string): boolean {
  return /token|secret|password|api[_-]?key|authorization|auth/i.test(key);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactValue(value: unknown, redactionValues: string[], key = ""): unknown {
  if (typeof value === "string") {
    const redacted = redactionValues
      .filter((item) => item.length >= 4)
      .reduce((next, secret) => next.replace(new RegExp(escapeRegex(secret), "g"), "[redacted]"), value);
    if (redacted.startsWith("secret://")) {
      return redacted;
    }
    return sensitiveKey(key) ? "[redacted]" : redacted;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, redactionValues, key));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, redactionValues, entryKey)
    ]));
  }
  return value;
}

function redactionValues(config: McpServerConfig): string[] {
  return [...Object.values(config.env), ...Object.values(config.headers)]
    .filter((value) => value && !value.startsWith("secret://"));
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
  return {
    ...config,
    env: await resolveSecretRecord(config.env, origin),
    headers: await resolveSecretRecord(config.headers, origin)
  };
}

function failurePolicyId(serverId: string): string {
  return `mcp.${serverId}.breaker.failures`;
}

function freezePolicyId(serverId: string): string {
  return `mcp.${serverId}.breaker.freeze`;
}

function recentFailureCount(db: Database, serverId: string, now = Date.now()): number {
  const since = new Date(now - BREAKER_WINDOW_MS).toISOString();
  return db.query<{ amount: number }, [string, string]>(`
    SELECT COALESCE(SUM(amount), 0) AS amount
    FROM quota_ledger
    WHERE policy_id = ?
      AND scope = 'mcp_server'
      AND metric = 'failures'
      AND created_at >= ?
  `).get(failurePolicyId(serverId), since)?.amount ?? 0;
}

function latestFreezeRow(db: Database, serverId: string): QuotaBreakerRow | null {
  return db.query<QuotaBreakerRow, [string]>(`
    SELECT amount, window_start, created_at
    FROM quota_ledger
    WHERE policy_id = ?
      AND scope = 'mcp_server'
      AND metric = 'failures'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(freezePolicyId(serverId)) ?? null;
}

function breakerStatusFromDb(db: Database, serverId: string, now = Date.now()): McpBreakerStatus {
  const latestFreeze = latestFreezeRow(db, serverId);
  const frozenUntilMs = latestFreeze && latestFreeze.amount > 0 ? new Date(latestFreeze.window_start).getTime() : 0;
  const state = frozenUntilMs > now ? "open" : latestFreeze && latestFreeze.amount > 0 ? "half_open" : "closed";
  return McpBreakerStatusSchema.parse({
    server_id: serverId,
    state,
    failure_count: recentFailureCount(db, serverId, now),
    threshold: BREAKER_THRESHOLD,
    frozen_until: latestFreeze && latestFreeze.amount > 0 ? latestFreeze.window_start : null,
    retry_after_ms: frozenUntilMs > now ? Math.max(0, frozenUntilMs - now) : 0
  });
}

function insertQuotaRow(db: Database, input: {
  policy_id: string;
  target: string;
  metric: "failures" | "requests";
  window: string;
  window_start: string;
  amount: number;
  trace_id: string;
  workspace_id: number | null;
  session_id?: string | null;
}): void {
  const timestamp = nowIso();
  db.query(`
    INSERT INTO quota_ledger (
      id, policy_id, scope, target, metric, window, window_start, amount,
      trace_id, workspace_id, session_id, created_at
    )
    VALUES (?, ?, 'mcp_server', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id("quota"),
    input.policy_id,
    input.target,
    input.metric,
    input.window,
    input.window_start,
    input.amount,
    input.trace_id,
    input.workspace_id,
    input.session_id ?? null,
    timestamp
  );
}

function recordMcpFailure(db: Database, serverId: string, traceId: string, workspaceId: number | null): McpBreakerStatus {
  const now = Date.now();
  insertQuotaRow(db, {
    policy_id: failurePolicyId(serverId),
    target: serverId,
    metric: "failures",
    window: "60s",
    window_start: new Date(now).toISOString(),
    amount: 1,
    trace_id: traceId,
    workspace_id: workspaceId
  });
  const failures = recentFailureCount(db, serverId, now);
  if (failures >= BREAKER_THRESHOLD) {
    insertQuotaRow(db, {
      policy_id: freezePolicyId(serverId),
      target: serverId,
      metric: "failures",
      window: "freeze",
      window_start: new Date(now + BREAKER_FREEZE_MS).toISOString(),
      amount: 1,
      trace_id: traceId,
      workspace_id: workspaceId
    });
    recordSystemEvent(db, createEvent({
      event_type: "quota.frozen",
      trace_id: traceId,
      workspace_id: workspaceId,
      session_id: null,
      source: "mcp",
      payload: { scope: "mcp_server", target: serverId, failures, freeze_ms: BREAKER_FREEZE_MS }
    }));
  }
  return breakerStatusFromDb(db, serverId, now);
}

function recordMcpSuccess(db: Database, serverId: string, traceId: string, workspaceId: number | null): McpBreakerStatus {
  insertQuotaRow(db, {
    policy_id: `mcp.${serverId}.requests`,
    target: serverId,
    metric: "requests",
    window: "60s",
    window_start: nowIso(),
    amount: 1,
    trace_id: traceId,
    workspace_id: workspaceId
  });
  const current = breakerStatusFromDb(db, serverId);
  if (current.state === "half_open") {
    insertQuotaRow(db, {
      policy_id: freezePolicyId(serverId),
      target: serverId,
      metric: "failures",
      window: "freeze",
      window_start: nowIso(),
      amount: 0,
      trace_id: traceId,
      workspace_id: workspaceId
    });
    recordSystemEvent(db, createEvent({
      event_type: "quota.unfrozen",
      trace_id: traceId,
      workspace_id: workspaceId,
      session_id: null,
      source: "mcp",
      payload: { scope: "mcp_server", target: serverId, reason: "half_open_success" }
    }));
  }
  return breakerStatusFromDb(db, serverId);
}

function recordSystemEvent(db: Database, event: WardEvent): void {
  db.query(`
    INSERT INTO system_event (id, event_type, trace_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(event.event_id, event.event_type, event.trace_id, JSON.stringify(event.payload), event.timestamp);
}

function recordMcpEvent(db: Database, input: {
  event_type: "mcp.tool_invoked" | "mcp.tool_result" | "mcp.tool_denied";
  trace_id: string;
  workspace_id: number | null;
  payload: Record<string, unknown>;
  redaction_values: string[];
}): void {
  recordSystemEvent(db, createEvent({
    event_type: input.event_type,
    trace_id: input.trace_id,
    workspace_id: input.workspace_id,
    session_id: null,
    source: "mcp",
    payload: redactValue(input.payload, input.redaction_values)
  }));
}

export function getMcpBreakerStatus(serverId: string): McpBreakerStatus {
  const db = openWardDatabase(resolveWardPaths());
  try {
    return breakerStatusFromDb(db, serverId);
  } finally {
    db.close();
  }
}

export function unfreezeMcpServerBreaker(serverId: string, traceId = createTraceId("mcp_unfreeze")): McpBreakerStatus {
  const db = openWardDatabase(resolveWardPaths());
  try {
    insertQuotaRow(db, {
      policy_id: freezePolicyId(serverId),
      target: serverId,
      metric: "failures",
      window: "freeze",
      window_start: nowIso(),
      amount: 0,
      trace_id: traceId,
      workspace_id: null
    });
    recordSystemEvent(db, createEvent({
      event_type: "quota.unfrozen",
      trace_id: traceId,
      workspace_id: null,
      session_id: null,
      source: "mcp",
      payload: { scope: "mcp_server", target: serverId, reason: "manual" }
    }));
    return breakerStatusFromDb(db, serverId);
  } finally {
    db.close();
  }
}

export async function callMcpToolThroughProxy(input: McpToolCallRequest): Promise<McpToolCallResult> {
  const parsed = McpToolCallRequestSchema.parse(input);
  const started = Date.now();
  const traceId = parsed.trace_id ?? createTraceId("mcp_call");
  const paths = resolveWardPaths();
  await ensureWardLayout(paths);
  const effective = await getEffectiveMcpConfig(parsed.workspace, { includeRepo: true, redact: false });
  const server = effective.servers.find((item) => item.id === parsed.server_id);
  if (!server) {
    throw new Error("MCP server not found");
  }
  if (server.config.ward_enabled === false) {
    throw new Error("MCP server is disabled");
  }
  if (server.config.transport !== "stdio") {
    throw new Error("Only stdio MCP calls are supported in this slice");
  }

  const policy = evaluateMcpPolicy({
    tool_name: parsed.tool_name,
    autonomy_level: parsed.autonomy_level,
    allowed_tools: parsed.allowed_tools,
    capability_profiles: parsed.capability_profiles,
    ci_green: parsed.ci_green,
    server_config: server.config
  });
  const resolvedConfig = await resolveMcpServerSecrets(server.config, server.origin);
  const secretValues = redactionValues(resolvedConfig);
  const db = openWardDatabase(paths);
  try {
    const breaker = breakerStatusFromDb(db, parsed.server_id);
    if (!policy.allowed) {
      recordMcpEvent(db, {
        event_type: "mcp.tool_denied",
        trace_id: traceId,
        workspace_id: effective.workspace_id,
        redaction_values: secretValues,
        payload: {
          server_id: parsed.server_id,
          tool_name: parsed.tool_name,
          arguments: parsed.arguments,
          ...policy.denial_payload
        }
      });
      return McpToolCallResultSchema.parse({
        ok: false,
        status: "denied",
        server_id: parsed.server_id,
        tool_name: parsed.tool_name,
        result: null,
        error: policy.denial_reason,
        synthetic_result: policy.synthetic_result,
        policy,
        breaker,
        trace_id: traceId,
        duration_ms: Date.now() - started
      });
    }

    if (breaker.state === "open") {
      const synthetic = McpSyntheticUnavailableResultSchema.parse({
        type: "server_unavailable",
        server_id: parsed.server_id,
        reason: "MCP server circuit breaker is open.",
        retry_after_ms: breaker.retry_after_ms
      });
      recordMcpEvent(db, {
        event_type: "mcp.tool_denied",
        trace_id: traceId,
        workspace_id: effective.workspace_id,
        redaction_values: secretValues,
        payload: {
          server_id: parsed.server_id,
          tool_name: parsed.tool_name,
          arguments: parsed.arguments,
          reason: synthetic.reason,
          retry_after_ms: synthetic.retry_after_ms
        }
      });
      return McpToolCallResultSchema.parse({
        ok: false,
        status: "unavailable",
        server_id: parsed.server_id,
        tool_name: parsed.tool_name,
        result: null,
        error: synthetic.reason,
        synthetic_result: synthetic,
        policy,
        breaker,
        trace_id: traceId,
        duration_ms: Date.now() - started
      });
    }

    recordMcpEvent(db, {
      event_type: "mcp.tool_invoked",
      trace_id: traceId,
      workspace_id: effective.workspace_id,
      redaction_values: secretValues,
      payload: {
        server_id: parsed.server_id,
        tool_name: parsed.tool_name,
        arguments: parsed.arguments,
        tool_class: policy.tool_class,
        autonomy_level: policy.autonomy_level
      }
    });

    try {
      const call = await callStdioMcpTool({
        command: resolvedConfig.command!,
        args: resolvedConfig.args,
        env: resolvedConfig.env,
        cwd: server.origin.repo_path ?? resolveRepoRoot(),
        timeout_ms: parsed.timeout_ms,
        stderr_log_path: mcpLogPath(paths, parsed.server_id),
        redaction_values: secretValues,
        tool_name: parsed.tool_name,
        arguments: parsed.arguments
      });
      const nextBreaker = recordMcpSuccess(db, parsed.server_id, traceId, effective.workspace_id);
      recordMcpEvent(db, {
        event_type: "mcp.tool_result",
        trace_id: traceId,
        workspace_id: effective.workspace_id,
        redaction_values: secretValues,
        payload: {
          server_id: parsed.server_id,
          tool_name: parsed.tool_name,
          result: call.result
        }
      });
      return McpToolCallResultSchema.parse({
        ok: true,
        status: "ok",
        server_id: parsed.server_id,
        tool_name: parsed.tool_name,
        result: redactValue(call.result, secretValues),
        error: null,
        synthetic_result: null,
        policy,
        breaker: nextBreaker,
        trace_id: traceId,
        duration_ms: Date.now() - started
      });
    } catch (error) {
      const nextBreaker = recordMcpFailure(db, parsed.server_id, traceId, effective.workspace_id);
      const message = error instanceof Error ? error.message : String(error);
      recordMcpEvent(db, {
        event_type: "mcp.tool_result",
        trace_id: traceId,
        workspace_id: effective.workspace_id,
        redaction_values: secretValues,
        payload: {
          server_id: parsed.server_id,
          tool_name: parsed.tool_name,
          error: message
        }
      });
      return McpToolCallResultSchema.parse({
        ok: false,
        status: "error",
        server_id: parsed.server_id,
        tool_name: parsed.tool_name,
        result: null,
        error: message,
        synthetic_result: null,
        policy,
        breaker: nextBreaker,
        trace_id: traceId,
        duration_ms: Date.now() - started
      });
    }
  } finally {
    db.close();
  }
}
