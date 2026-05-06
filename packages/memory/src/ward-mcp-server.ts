import {
  WardMcpGetPlanPacketInputSchema,
  WardMcpGetSessionInputSchema,
  WardMcpGetWorkspaceInputSchema,
  WardMcpListActiveBlockersInputSchema,
  WardMcpListPlanPacketsInputSchema,
  WardMcpListSessionsInputSchema,
  WardMcpListWorkspacesInputSchema,
  WardMcpReadWikiPageInputSchema,
  WardMcpSearchInputSchema,
  WardMcpStatusInputSchema,
  WardMcpToolNameSchema,
  WARD_VERSION,
  nowIso,
  type HarnessLifecycleState,
  type WardMcpToolName
} from "@ward/core";
import { getPlanDetail, listPlans } from "./plan.ts";
import { getHarnessSessionDetail, listHarnessSessions } from "./sessions.ts";
import { listTasks, listWorkspaces, readWorkspaceDetail } from "./repositories.ts";
import { readWikiPage, searchMemory } from "./wiki.ts";

type JsonRpcId = number | string | null;

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

type ToolDefinition = {
  name: WardMcpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type WardMcpServerOptions = {
  session_token?: string;
};

const MAX_STRING_LENGTH = 12000;
const MAX_ARRAY_LENGTH = 50;
const MAX_DEPTH = 7;

const authProperties = {
  token: {
    type: "string",
    description: "Short-lived WARD MCP session token."
  }
};

const authRequired = ["token"];

const WARD_MCP_TOOLS: ToolDefinition[] = [
  {
    name: "ward.list_workspaces",
    description: "List WARD workspace summaries.",
    inputSchema: {
      type: "object",
      properties: {
        ...authProperties,
        limit: { type: "number", minimum: 1, maximum: 50, default: 20 }
      },
      required: authRequired
    }
  },
  {
    name: "ward.get_workspace",
    description: "Read one WARD workspace with repos, attachments, and tasks.",
    inputSchema: {
      type: "object",
      properties: {
        ...authProperties,
        id: { anyOf: [{ type: "string" }, { type: "number" }] }
      },
      required: [...authRequired, "id"]
    }
  },
  {
    name: "ward.list_sessions",
    description: "List WARD harness sessions.",
    inputSchema: {
      type: "object",
      properties: {
        ...authProperties,
        workspace: { type: "string" },
        state: { type: "string" },
        include_incognito: { type: "boolean", default: false },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20 }
      },
      required: authRequired
    }
  },
  {
    name: "ward.get_session",
    description: "Read one WARD harness session with bounded events and artifacts.",
    inputSchema: {
      type: "object",
      properties: {
        ...authProperties,
        id: { type: "string" },
        event_limit: { type: "number", minimum: 1, maximum: 50, default: 20 }
      },
      required: [...authRequired, "id"]
    }
  },
  {
    name: "ward.list_plan_packets",
    description: "List WARD plan packet summaries.",
    inputSchema: {
      type: "object",
      properties: {
        ...authProperties,
        workspace: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20 }
      },
      required: authRequired
    }
  },
  {
    name: "ward.get_plan_packet",
    description: "Read one WARD plan packet and its transcript metadata.",
    inputSchema: {
      type: "object",
      properties: {
        ...authProperties,
        id: { type: "string" }
      },
      required: [...authRequired, "id"]
    }
  },
  {
    name: "ward.read_wiki_page",
    description: "Read one WARD wiki page from universal or workspace memory.",
    inputSchema: {
      type: "object",
      properties: {
        ...authProperties,
        scope: { type: "string" },
        page: { type: "string" }
      },
      required: [...authRequired, "scope", "page"]
    }
  },
  {
    name: "ward.search",
    description: "Search WARD memory.",
    inputSchema: {
      type: "object",
      properties: {
        ...authProperties,
        query: { type: "string" },
        scope: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20 }
      },
      required: [...authRequired, "query"]
    }
  },
  {
    name: "ward.list_active_blockers",
    description: "List active blocker-like WARD tasks.",
    inputSchema: {
      type: "object",
      properties: {
        ...authProperties,
        workspace: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20 }
      },
      required: authRequired
    }
  },
  {
    name: "ward.status",
    description: "Return a synthetic worker status acknowledgement without requiring a token.",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", default: "visible" },
        detail: { type: "string", default: "WARD MCP status check." },
        progress_pct: { type: "number", minimum: 0, maximum: 1, default: 0 }
      }
    }
  }
];

class McpJsonRpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message);
  }
}

function sensitiveKey(key: string): boolean {
  return /token|secret|password|api[_-]?key|authorization|auth|cookie/i.test(key);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactString(value: string, secrets: string[]): string {
  return secrets
    .filter((secret) => secret.length >= 4)
    .reduce((next, secret) => next.replace(new RegExp(escapeRegex(secret), "g"), "[redacted]"), value);
}

function redactAndBound(value: unknown, secrets: string[], key = "", depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return "[bounded]";
  }
  if (typeof value === "string") {
    const redacted = sensitiveKey(key) ? "[redacted]" : redactString(value, secrets);
    return redacted.length > MAX_STRING_LENGTH
      ? `${redacted.slice(0, MAX_STRING_LENGTH)}...[truncated ${redacted.length - MAX_STRING_LENGTH} chars]`
      : redacted;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    const bounded = value.slice(0, MAX_ARRAY_LENGTH)
      .map((item) => redactAndBound(item, secrets, key, depth + 1));
    if (value.length > MAX_ARRAY_LENGTH) {
      bounded.push(`[truncated ${value.length - MAX_ARRAY_LENGTH} items]`);
    }
    return bounded;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, MAX_ARRAY_LENGTH).map(([entryKey, entryValue]) => [
      entryKey,
      redactAndBound(entryValue, secrets, entryKey, depth + 1)
    ]));
  }
  return null;
}

function textResult(value: unknown, secrets: string[]): Record<string, unknown> {
  const structuredContent = redactAndBound(value, secrets);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent
  };
}

function jsonRpcResult(id: JsonRpcId, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function jsonRpcError(id: JsonRpcId, error: JsonRpcError): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error })}\n`);
}

function toolArguments(params: unknown): { name: WardMcpToolName; arguments: unknown } {
  const data = typeof params === "object" && params !== null
    ? params as { name?: unknown; arguments?: unknown }
    : {};
  const name = WardMcpToolNameSchema.parse(data.name);
  return { name, arguments: data.arguments ?? {} };
}

function expectedToken(options: WardMcpServerOptions): string | null {
  return options.session_token
    ?? process.env.WARD_MCP_SESSION_TOKEN
    ?? process.env.WARD_MCP_TOKEN
    ?? null;
}

function assertAuthorized(toolName: WardMcpToolName, args: unknown, options: WardMcpServerOptions): void {
  if (toolName === "ward.status") {
    return;
  }
  const token = typeof args === "object" && args !== null && "token" in args
    ? (args as { token?: unknown }).token
    : undefined;
  const expected = expectedToken(options);
  if (!expected || token !== expected) {
    throw new McpJsonRpcError(-32001, "WARD MCP token required for read tools.", {
      reason: "unauthorized",
      tool_name: toolName
    });
  }
}

function compactWorkspaceDetail(value: ReturnType<typeof readWorkspaceDetail>): Record<string, unknown> {
  return {
    workspace: value.workspace,
    repos: value.repos,
    attachments: value.attachments.map((attachment) => ({
      id: attachment.id,
      workspace_id: attachment.workspace_id,
      name: attachment.name,
      source_path: attachment.source_path,
      kind: attachment.kind,
      bytes: attachment.bytes,
      created_at: attachment.created_at
    })),
    tasks: value.tasks.map((task) => ({
      id: task.id,
      workspace_id: task.workspace_id,
      title: task.title,
      status: task.status,
      lifecycle_phase: task.lifecycle_phase,
      type: task.type,
      priority: task.priority,
      owner: task.owner,
      updated_at: task.updated_at
    }))
  };
}

async function invokeWardTool(toolName: WardMcpToolName, args: unknown): Promise<unknown> {
  switch (toolName) {
    case "ward.list_workspaces": {
      const input = WardMcpListWorkspacesInputSchema.parse(args);
      return { workspaces: listWorkspaces().slice(0, input.limit) };
    }
    case "ward.get_workspace": {
      const input = WardMcpGetWorkspaceInputSchema.parse(args);
      return compactWorkspaceDetail(readWorkspaceDetail(input.id));
    }
    case "ward.list_sessions": {
      const input = WardMcpListSessionsInputSchema.parse(args);
      return {
        sessions: listHarnessSessions({
          workspace: input.workspace,
          state: input.state as HarnessLifecycleState | undefined,
          include_incognito: input.include_incognito
        }).slice(0, input.limit)
      };
    }
    case "ward.get_session": {
      const input = WardMcpGetSessionInputSchema.parse(args);
      const detail = await getHarnessSessionDetail(input.id);
      return {
        session: detail.session,
        launch: {
          session_id: detail.launch.session_id,
          workspace_id: detail.launch.workspace_id,
          task_id: detail.launch.task_id,
          brain_id: detail.launch.brain_id,
          runtime_kind: detail.launch.runtime_kind,
          mode: detail.launch.mode,
          working_dir: detail.launch.working_dir,
          task_contract: detail.launch.task_contract,
          context_packet: detail.launch.context_packet,
          allowed_tools: detail.launch.allowed_tools,
          timeouts: detail.launch.timeouts,
          autonomy_level: detail.launch.autonomy_level,
          incognito: detail.launch.incognito,
          created_at: detail.launch.created_at,
          scenario: detail.launch.scenario
        },
        events: detail.events.slice(-input.event_limit),
        artifacts: detail.artifacts,
        pty_output_tail: detail.pty_output.slice(-MAX_STRING_LENGTH)
      };
    }
    case "ward.list_plan_packets": {
      const input = WardMcpListPlanPacketsInputSchema.parse(args);
      return {
        plans: listPlans(input.workspace).slice(0, input.limit).map((detail) => ({
          session: detail.session,
          packet: detail.packet
            ? {
                packet_id: detail.packet.packet_id,
                workspace_id: detail.packet.workspace_id,
                title: detail.packet.title,
                status: detail.packet.status,
                version: detail.packet.version,
                updated_at: detail.packet.updated_at
              }
            : null,
          round_count: detail.rounds.length
        }))
      };
    }
    case "ward.get_plan_packet": {
      const input = WardMcpGetPlanPacketInputSchema.parse(args);
      return getPlanDetail(input.id);
    }
    case "ward.read_wiki_page": {
      const input = WardMcpReadWikiPageInputSchema.parse(args);
      return { page: await readWikiPage(input.scope, input.page) };
    }
    case "ward.search": {
      const input = WardMcpSearchInputSchema.parse(args);
      return { hits: await searchMemory(input.query, { scope: input.scope, limit: input.limit }) };
    }
    case "ward.list_active_blockers": {
      const input = WardMcpListActiveBlockersInputSchema.parse(args);
      const blockerStatuses = new Set(["blocked", "needs_user", "needs_work"]);
      return {
        blockers: listTasks({ workspace: input.workspace })
          .filter((task) => blockerStatuses.has(task.status))
          .slice(0, input.limit)
          .map((task) => ({
            id: task.id,
            workspace_id: task.workspace_id,
            title: task.title,
            status: task.status,
            lifecycle_phase: task.lifecycle_phase,
            priority: task.priority,
            owner: task.owner,
            updated_at: task.updated_at
          }))
      };
    }
    case "ward.status": {
      const input = WardMcpStatusInputSchema.parse(args);
      return {
        ok: true,
        state: input.state,
        detail: input.detail,
        progress_pct: input.progress_pct,
        timestamp: nowIso()
      };
    }
    default:
      throw new McpJsonRpcError(-32601, `Unknown WARD MCP tool: ${toolName}`);
  }
}

async function handleToolsCall(request: JsonRpcRequest, options: WardMcpServerOptions, secrets: string[]): Promise<void> {
  const call = toolArguments((request.params as { name?: unknown; arguments?: unknown } | undefined));
  assertAuthorized(call.name, call.arguments, options);
  const result = await invokeWardTool(call.name, call.arguments);
  jsonRpcResult(request.id ?? null, textResult(result, secrets));
}

async function handleRequest(request: JsonRpcRequest, options: WardMcpServerOptions, secrets: string[]): Promise<void> {
  if (request.method === "notifications/initialized") {
    return;
  }
  if (request.id === undefined) {
    return;
  }
  if (request.method === "initialize") {
    jsonRpcResult(request.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: {
        name: "ward",
        version: WARD_VERSION
      }
    });
    return;
  }
  if (request.method === "tools/list") {
    jsonRpcResult(request.id, { tools: WARD_MCP_TOOLS });
    return;
  }
  if (request.method === "tools/call") {
    await handleToolsCall(request, options, secrets);
    return;
  }
  throw new McpJsonRpcError(-32601, `Unknown method: ${request.method ?? "unknown"}`);
}

export async function runWardMcpServer(options: WardMcpServerOptions = {}): Promise<void> {
  const secrets = [
    expectedToken(options),
    ...Object.entries(process.env)
      .filter(([key, value]) => Boolean(value) && sensitiveKey(key))
      .map(([, value]) => value)
  ].flatMap((value) => value ? [value] : []);

  let buffer = "";
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value);
    while (buffer.includes("\n")) {
      const separator = buffer.indexOf("\n");
      const line = buffer.slice(0, separator).trim();
      buffer = buffer.slice(separator + 1);
      if (!line) {
        continue;
      }
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line) as JsonRpcRequest;
      } catch {
        jsonRpcError(null, { code: -32700, message: "Parse error" });
        continue;
      }
      try {
        await handleRequest(request, options, secrets);
      } catch (error) {
        if (error instanceof McpJsonRpcError) {
          jsonRpcError(request.id ?? null, {
            code: error.code,
            message: error.message,
            data: redactAndBound(error.data, secrets)
          });
          continue;
        }
        jsonRpcError(request.id ?? null, {
          code: -32603,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}
