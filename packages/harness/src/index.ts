import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  HarnessLifecycleStateSchema,
  StubWorkerEnvelopeSchema,
  createEvent,
  type HarnessAdapter,
  type HarnessLaunch,
  type HarnessLifecycleState,
  type StubWorkerEnvelope,
  type WardEvent
} from "@ward/core";

export {
  chatCompletion,
  streamChatCompletion,
  ollamaChat,
  streamOllamaChat,
  probeOpenAiCompatible,
  OpenAiCompatibleError
} from "./openai-compatible.js";
export type {
  ChatMessage,
  ChatCompletionRequest,
  ChatStreamEvent
} from "./openai-compatible.js";

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined as T, done: true });
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.values.length > 0) {
      return { value: this.values.shift() as T, done: false };
    }
    if (this.closed) {
      return { value: undefined as T, done: true };
    }
    return new Promise<IteratorResult<T>>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }
}

export type RunningHarness = {
  sessionId: string;
  pid: number | null;
  events(): AsyncIterable<WardEvent>;
  terminal(): AsyncIterable<string>;
  write(input: string): Promise<void>;
  cancel(): Promise<void>;
  closed: Promise<{ exitCode: number | null; signalCode: NodeJS.Signals | null }>;
};

function mapEnvelopeToEvent(launch: HarnessLaunch, envelope: StubWorkerEnvelope): WardEvent {
  if (envelope.type === "status") {
    return createEvent({
      event_type: "worker.status",
      trace_id: launch.context_packet.trace_id,
      workspace_id: launch.workspace_id,
      session_id: launch.session_id,
      source: "harness",
      payload: envelope
    });
  }
  if (envelope.type === "message") {
    return createEvent({
      event_type: "worker.message",
      trace_id: launch.context_packet.trace_id,
      workspace_id: launch.workspace_id,
      session_id: launch.session_id,
      source: "agent",
      payload: envelope
    });
  }
  if (envelope.type === "artifact") {
    return createEvent({
      event_type: "agent.artifact_written",
      trace_id: launch.context_packet.trace_id,
      workspace_id: launch.workspace_id,
      session_id: launch.session_id,
      source: "agent",
      payload: envelope
    });
  }
  if (envelope.type === "tool_call") {
    const allowed = launch.allowed_tools.includes(envelope.tool_name);
    return createEvent({
      event_type: allowed ? "mcp.tool_result" : "mcp.tool_denied",
      trace_id: launch.context_packet.trace_id,
      workspace_id: launch.workspace_id,
      session_id: launch.session_id,
      source: "mcp",
      payload: allowed
        ? {
            tool_name: envelope.tool_name,
            input: envelope.input ?? null,
            result: "stub tool call accepted"
          }
        : {
            tool_name: envelope.tool_name,
            input: envelope.input ?? null,
            reason: "Tool is not in the session allowlist.",
            allowed_tools: launch.allowed_tools
          }
    });
  }
  if (envelope.type === "agent_signal") {
    return createEvent({
      event_type: envelope.agent_id === "qa-supervisor" ? "agent.qa_reviewed" : "agent.signal",
      trace_id: launch.context_packet.trace_id,
      workspace_id: launch.workspace_id,
      session_id: launch.session_id,
      source: "agent",
      payload: envelope
    });
  }
  if (envelope.type === "file_write") {
    return createEvent({
      event_type: "fs.file_written",
      trace_id: launch.context_packet.trace_id,
      workspace_id: launch.workspace_id,
      session_id: launch.session_id,
      source: "harness",
      payload: envelope
    });
  }
  return createEvent({
    event_type: "mcp.tool_denied",
    trace_id: launch.context_packet.trace_id,
    workspace_id: launch.workspace_id,
    session_id: launch.session_id,
    source: "mcp",
    payload: envelope
  });
}

function createStdoutConsumer(
  launch: HarnessLaunch,
  emitEvent: (event: WardEvent) => void,
  emitTerminal: (data: string) => void
): (text: string) => void {
  let buffer = "";
  return (text: string) => {
    emitTerminal(text);
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("{")) {
        continue;
      }
      try {
        const envelope = StubWorkerEnvelopeSchema.parse(JSON.parse(trimmed));
        emitEvent(mapEnvelopeToEvent(launch, envelope));
      } catch (error) {
        emitEvent(createEvent({
          event_type: "worker.status_invalid",
          trace_id: launch.context_packet.trace_id,
          workspace_id: launch.workspace_id,
          session_id: launch.session_id,
          source: "harness",
          payload: {
            line: trimmed,
            error: error instanceof Error ? error.message : String(error)
          }
        }));
      }
    }
  };
}

function consumeStdout(
  launch: HarnessLaunch,
  child: { stdout: NodeJS.ReadableStream },
  emitEvent: (event: WardEvent) => void,
  emitTerminal: (data: string) => void
): void {
  const consume = createStdoutConsumer(launch, emitEvent, emitTerminal);
  child.stdout.on("data", (chunk) => consume(String(chunk)));
}

function consumeStderr(
  launch: HarnessLaunch,
  child: { stderr: NodeJS.ReadableStream },
  emitEvent: (event: WardEvent) => void,
  emitTerminal: (data: string) => void
): void {
  let buffer = "";
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    emitTerminal(text);
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      emitEvent(createEvent({
        event_type: "worker.stderr",
        trace_id: launch.context_packet.trace_id,
        workspace_id: launch.workspace_id,
        session_id: launch.session_id,
        source: "harness",
        payload: { text: trimmed }
      }));
    }
  });
}

type CliVendor = "claude" | "codex";

type CommandResult = {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

function runProbe(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
    timer.unref?.();
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, signalCode: null, stdout, stderr, error });
    });
    child.on("exit", (exitCode, signalCode) => {
      clearTimeout(timer);
      resolve({ exitCode, signalCode, stdout, stderr });
    });
  });
}

function createHarnessEvent(
  launch: HarnessLaunch,
  event_type: string,
  source: WardEvent["source"],
  payload: unknown
): WardEvent {
  return createEvent({
    event_type,
    trace_id: launch.context_packet.trace_id,
    workspace_id: launch.workspace_id,
    session_id: launch.session_id,
    source,
    payload
  });
}

function statusEvent(
  launch: HarnessLaunch,
  state: HarnessLifecycleState,
  detail: string,
  progress_pct: number
): WardEvent {
  return createHarnessEvent(launch, "worker.status", "harness", {
    type: "status",
    state,
    detail,
    progress_pct
  });
}

function messageEvent(launch: HarnessLaunch, vendor: CliVendor, text: string, rawType?: string): WardEvent {
  return createHarnessEvent(launch, "worker.message", "agent", {
    type: "message",
    role: "assistant",
    text,
    vendor,
    raw_type: rawType ?? null
  });
}

function errorEvent(launch: HarnessLaunch, vendor: CliVendor, text: string, recoverable = true): WardEvent {
  return createHarnessEvent(launch, "worker.error", "harness", {
    vendor,
    error: text,
    recoverable
  });
}

function terminalEvent(launch: HarnessLaunch, data: string): WardEvent {
  return createHarnessEvent(launch, "worker.terminal", "harness", { data });
}

function parseStatusMarkers(text: string): Array<{ state: HarnessLifecycleState; detail: string; progress_pct: number }> {
  const markers: Array<{ state: HarnessLifecycleState; detail: string; progress_pct: number }> = [];
  const markerPattern = /<<WARD_STATUS\s+([^>]+)>>/g;
  for (const match of text.matchAll(markerPattern)) {
    const attributes = match[1];
    const pairs = new Map<string, string>();
    const attrPattern = /(\w+)=("([^"]*)"|'([^']*)'|[^\s]+)/g;
    for (const attr of attributes.matchAll(attrPattern)) {
      pairs.set(attr[1], attr[3] ?? attr[4] ?? attr[2].replace(/^["']|["']$/g, ""));
    }
    const stateRaw = pairs.get("state");
    const parsedState = stateRaw ? HarnessLifecycleStateSchema.safeParse(stateRaw) : null;
    if (!parsedState?.success) {
      continue;
    }
    const pctRaw = Number(pairs.get("pct") ?? pairs.get("progress_pct") ?? "0");
    markers.push({
      state: parsedState.data,
      detail: pairs.get("detail") ?? "Worker reported status.",
      progress_pct: Number.isFinite(pctRaw) ? Math.max(0, Math.min(1, pctRaw)) : 0
    });
  }
  return markers;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringifyCompact(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractText(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of ["text", "message", "result", "summary", "content"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  const delta = asRecord(record.delta);
  if (typeof delta?.text === "string" && delta.text.trim()) {
    return delta.text.trim();
  }
  const block = asRecord(record.content_block);
  if (typeof block?.text === "string" && block.text.trim()) {
    return block.text.trim();
  }
  const message = asRecord(record.message);
  if (message) {
    const messageText = extractText(message);
    if (messageText) {
      return messageText;
    }
  }
  const error = asRecord(record.error);
  if (error) {
    const errorText = extractText(error);
    if (errorText) {
      return errorText;
    }
  }
  const content = record.content ?? message?.content;
  if (Array.isArray(content)) {
    const parts = content.flatMap((item) => {
      const text = extractText(item);
      return text ? [text] : [];
    });
    if (parts.length > 0) {
      return parts.join("\n").trim();
    }
  }
  return null;
}

function extractRawType(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return typeof record.type === "string"
    ? record.type
    : typeof record.event === "string"
      ? record.event
      : undefined;
}

function extractToolName(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of ["tool_name", "name", "tool"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  const item = asRecord(record.item);
  return typeof item?.name === "string" ? item.name : null;
}

function summarizeVendorPayload(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) {
    return value;
  }
  const summary: Record<string, unknown> = {};
  for (const key of ["type", "subtype", "event", "session_id", "uuid", "model", "permissionMode", "apiKeySource", "claude_code_version"]) {
    if (record[key] !== undefined) {
      summary[key] = record[key];
    }
  }
  if (Array.isArray(record.tools)) {
    summary.tool_count = record.tools.length;
  }
  if (Array.isArray(record.mcp_servers)) {
    summary.mcp_server_count = record.mcp_servers.length;
  }
  if (Array.isArray(record.skills)) {
    summary.skill_count = record.skills.length;
  }
  if (Array.isArray(record.plugins)) {
    summary.plugin_count = record.plugins.length;
  }
  if (record.rate_limit_info) {
    summary.rate_limit_info = record.rate_limit_info;
  }
  if (record.usage) {
    summary.usage = record.usage;
  }
  if (record.modelUsage) {
    summary.modelUsage = record.modelUsage;
  }
  return Object.keys(summary).length > 0 ? summary : value;
}

function statusFromJson(value: unknown): { state: HarnessLifecycleState; detail: string; progress_pct: number } | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const args = asRecord(record.arguments) ?? asRecord(record.input) ?? asRecord(record.payload) ?? record;
  const stateRaw = args.state;
  const parsedState = typeof stateRaw === "string" ? HarnessLifecycleStateSchema.safeParse(stateRaw) : null;
  if (!parsedState?.success) {
    return null;
  }
  const pct = Number(args.progress_pct ?? args.pct ?? 0);
  return {
    state: parsedState.data,
    detail: typeof args.detail === "string" ? args.detail : "Worker reported status.",
    progress_pct: Number.isFinite(pct) ? Math.max(0, Math.min(1, pct)) : 0
  };
}

function mapVendorJsonToEvents(launch: HarnessLaunch, vendor: CliVendor, value: unknown): WardEvent[] {
  const parsedStub = StubWorkerEnvelopeSchema.safeParse(value);
  if (parsedStub.success) {
    return [mapEnvelopeToEvent(launch, parsedStub.data)];
  }

  const status = statusFromJson(value);
  if (status) {
    return [statusEvent(launch, status.state, status.detail, status.progress_pct)];
  }

  const rawType = extractRawType(value);
  const rawTypeLower = rawType?.toLowerCase() ?? "";
  if (rawTypeLower.includes("error") || rawTypeLower.includes("failed")) {
    return [errorEvent(launch, vendor, extractText(value) ?? stringifyCompact(value), true)];
  }

  const toolName = extractToolName(value);
  if (toolName && rawTypeLower.includes("tool")) {
    return [createHarnessEvent(launch, "worker.tool_call", "agent", {
      vendor,
      raw_type: rawType ?? null,
      tool_name: toolName,
      arguments: asRecord(value)?.arguments ?? asRecord(value)?.input ?? null,
      allowed: launch.allowed_tools.includes(toolName)
    })];
  }

  const text = extractText(value);
  if (text) {
    return [
      ...parseStatusMarkers(text).map((marker) => statusEvent(launch, marker.state, marker.detail, marker.progress_pct)),
      messageEvent(launch, vendor, text, rawType)
    ];
  }

  if (rawType) {
    return [createHarnessEvent(launch, "worker.vendor_event", "harness", {
      vendor,
      raw_type: rawType,
      payload: summarizeVendorPayload(value)
    })];
  }

  return [];
}

function createCliStdoutConsumer(
  launch: HarnessLaunch,
  vendor: CliVendor,
  emitEvent: (event: WardEvent) => void,
  emitTerminal: (data: string) => void
): (text: string) => void {
  let buffer = "";
  return (text: string) => {
    emitTerminal(text);
    for (const marker of parseStatusMarkers(text)) {
      emitEvent(statusEvent(launch, marker.state, marker.detail, marker.progress_pct));
    }
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("{")) {
        continue;
      }
      try {
        const json = JSON.parse(trimmed);
        for (const event of mapVendorJsonToEvents(launch, vendor, json)) {
          emitEvent(event);
        }
      } catch (error) {
        emitEvent(createHarnessEvent(launch, "worker.status_invalid", "harness", {
          vendor,
          line: trimmed,
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    }
  };
}

function buildCliHarnessPrompt(input: HarnessLaunch, vendor: CliVendor): string {
  const criteria = input.task_contract.acceptance_criteria
    .map((criterion, index) => `${criterion.id ?? `AC${index + 1}`}: ${criterion.statement}`)
    .join("\n");
  const constraints = input.task_contract.constraints.map((item) => `- ${item}`).join("\n");
  const docs = input.task_contract.source_docs.length > 0
    ? input.task_contract.source_docs.map((item) => `- ${item}`).join("\n")
    : "- No explicit source docs provided.";
  const artifacts = input.context_packet.durable_artifact_refs.length > 0
    ? input.context_packet.durable_artifact_refs.map((item) => `- ${item.kind}: ${item.path}${item.excerpt ? ` (${item.excerpt})` : ""}`).join("\n")
    : "- None.";
  return [
    "You are running inside a WARD harness session.",
    "",
    `Harness: ${vendor}`,
    `Session: ${input.session_id}`,
    `Workspace ID: ${input.workspace_id}`,
    `Task ID: ${input.task_contract.task_id ?? "none"}`,
    `Working directory: ${input.working_dir}`,
    "",
    "Goal:",
    input.task_contract.goal,
    "",
    "Constraints:",
    constraints || "- Stay inside the working directory.",
    "",
    "Acceptance Criteria:",
    criteria || "- Provide a concise result and identify any blocker.",
    "",
    "Source Docs:",
    docs,
    "",
    "Context:",
    `- Summary: ${input.context_packet.workspace_summary}`,
    `- Repo snapshot: ${input.context_packet.repo_snapshot_ref || "none"}`,
    `- Durable artifacts:\n${artifacts}`,
    input.context_packet.active_blockers.length > 0
      ? `- Active blockers: ${input.context_packet.active_blockers.join("; ")}`
      : "- Active blockers: none",
    "",
    "Reporting:",
    "- Keep changes scoped to the goal and constraints.",
    "- If you are blocked, explain the blocker and do not guess.",
    "- Emit lifecycle markers when useful using exactly this plain-text form:",
    '  <<WARD_STATUS state=implementing detail="short status" pct=0.35>>',
    "- Finish with a concise summary of what changed, tests run, and remaining risk."
  ].join("\n");
}

function claudePermissionMode(input: HarnessLaunch): string {
  if (input.autonomy_level === "strict") {
    return "plan";
  }
  if (input.autonomy_level === "lenient") {
    return "acceptEdits";
  }
  return "default";
}

function codexSandbox(input: HarnessLaunch): string {
  return input.autonomy_level === "strict" ? "read-only" : "workspace-write";
}

function cliEnv(input: HarnessLaunch): NodeJS.ProcessEnv {
  return {
    ...process.env,
    WARD_SESSION_ID: input.session_id,
    WARD_TRACE_ID: input.context_packet.trace_id,
    WARD_TASK_ID: input.task_id ?? "",
    WARD_BRAIN_ID: input.brain_id,
    WARD_MCP_OVERLAY_PATH: input.mcp_overlay_path
  };
}

function cliCommand(input: HarnessLaunch, vendor: CliVendor): { command: string; args: string[] } {
  const prompt = buildCliHarnessPrompt(input, vendor);
  if (vendor === "claude") {
    if (input.mode === "visible") {
      return {
        command: "claude",
        args: ["--permission-mode", claudePermissionMode(input), prompt]
      };
    }
    return {
      command: "claude",
      args: [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        claudePermissionMode(input),
        "--mcp-config",
        input.mcp_overlay_path
      ]
    };
  }

  if (input.mode === "visible") {
    return {
      command: "codex",
      args: ["-C", input.working_dir, "--sandbox", codexSandbox(input), prompt]
    };
  }
  return {
    command: "codex",
    args: [
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "-C",
      input.working_dir,
      "--sandbox",
      codexSandbox(input),
      "--color",
      "never",
      prompt
    ]
  };
}

function blockedHarness(input: HarnessLaunch, vendor: CliVendor, detail: string): RunningHarness {
  const queue = new AsyncQueue<WardEvent>();
  const terminalQueue = new AsyncQueue<string>();
  terminalQueue.push(`${detail}\n`);
  queue.push(terminalEvent(input, `${detail}\n`));
  queue.push(errorEvent(input, vendor, detail, false));
  queue.push(statusEvent(input, "blocked", detail, 1));
  queue.close();
  terminalQueue.close();
  return {
    sessionId: input.session_id,
    pid: null,
    events: () => queue,
    terminal: () => terminalQueue,
    write: async () => undefined,
    cancel: async () => undefined,
    closed: Promise.resolve({ exitCode: 1, signalCode: null })
  };
}

async function probeClaude(cwd: string): Promise<{ ok: boolean; detail: string }> {
  const version = await runProbe("claude", ["--version"], cwd);
  if (version.error || version.exitCode !== 0) {
    return { ok: false, detail: version.error?.message ?? (version.stderr.trim() || "claude --version failed.") };
  }
  const status = await runProbe("claude", ["auth", "status"], cwd);
  const raw = `${status.stdout}\n${status.stderr}`.trim();
  try {
    const parsed = JSON.parse(status.stdout) as { loggedIn?: boolean; authMethod?: string };
    if (parsed.loggedIn) {
      return { ok: true, detail: `Claude Code ${version.stdout.trim()}; auth ${parsed.authMethod ?? "ok"}` };
    }
    return { ok: false, detail: "Claude Code auth is not logged in. Run `claude auth login`." };
  } catch {
    if (status.exitCode === 0 && !/not logged in|loggedIn.*false/i.test(raw)) {
      return { ok: true, detail: `Claude Code ${version.stdout.trim()}; auth status available` };
    }
    return { ok: false, detail: raw || "Claude Code auth status failed." };
  }
}

async function probeCodex(cwd: string): Promise<{ ok: boolean; detail: string }> {
  const version = await runProbe("codex", ["--version"], cwd);
  if (version.error || version.exitCode !== 0) {
    return { ok: false, detail: version.error?.message ?? (version.stderr.trim() || "codex --version failed.") };
  }
  const status = await runProbe("codex", ["login", "status"], cwd);
  const raw = `${status.stdout}\n${status.stderr}`.trim();
  if (status.exitCode === 0 && /logged in/i.test(raw)) {
    return { ok: true, detail: `${version.stdout.trim()}; ${status.stdout.trim()}` };
  }
  return { ok: false, detail: raw || "Codex login status failed. Run `codex login`." };
}

abstract class CliHarnessAdapter implements HarnessAdapter {
  abstract readonly kind: string;
  readonly runtimeKind = "cli" as const;
  protected abstract readonly vendor: CliVendor;

  async probe(cwd = process.cwd()): Promise<{ ok: boolean; detail: string }> {
    return this.vendor === "claude" ? probeClaude(cwd) : probeCodex(cwd);
  }

  async launch(input: HarnessLaunch): Promise<RunningHarness> {
    const probe = await this.probe(input.working_dir);
    if (!probe.ok) {
      return blockedHarness(input, this.vendor, probe.detail);
    }

    const queue = new AsyncQueue<WardEvent>();
    const terminalQueue = new AsyncQueue<string>();
    const ptyBridge = join(import.meta.dir, "pty-bridge.cjs");
    const command = cliCommand(input, this.vendor);
    const child = input.mode === "visible"
      ? spawn("node", [ptyBridge, command.command, ...command.args], {
          cwd: input.working_dir,
          stdio: ["pipe", "pipe", "pipe"],
          env: cliEnv(input)
        })
      : spawn(command.command, command.args, {
          cwd: input.working_dir,
          stdio: ["ignore", "pipe", "pipe"],
          env: cliEnv(input)
        });
    let watchdogTripped = false;
    let terminalStateSeen = false;
    let blockedReason: string | null = null;
    let wallClockTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      if (wallClockTimer) {
        clearTimeout(wallClockTimer);
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
    };
    const tripWatchdog = (kind: "wall_clock_timeout" | "idle_timeout") => {
      if (watchdogTripped) {
        return;
      }
      watchdogTripped = true;
      clearTimers();
      const detail = kind === "idle_timeout"
        ? `No ${this.vendor} output for ${input.timeouts.idle_max_ms} ms.`
        : `${this.vendor} exceeded ${input.timeouts.wall_clock_max_ms} ms wall-clock limit.`;
      queue.push(createHarnessEvent(input, "watchdog.timeout", "harness", { kind, detail }));
      queue.push(statusEvent(input, "blocked", detail, 1));
      child.kill("SIGTERM");
    };
    const resetIdleTimer = () => {
      if (watchdogTripped) {
        return;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => tripWatchdog("idle_timeout"), input.timeouts.idle_max_ms);
      idleTimer.unref?.();
    };
    const emitEvent = (event: WardEvent) => {
      queue.push(event);
      if (event.event_type === "worker.error") {
        const payload = event.payload as { error?: unknown };
        const errorText = typeof payload.error === "string" ? payload.error : "";
        if (/usage limit|quota|rate limit|auth|login|tokenrefresh|permission/i.test(errorText)) {
          blockedReason = errorText;
        }
      }
      if (event.event_type === "worker.status") {
        const payload = event.payload as { state?: unknown };
        if (payload.state === "done" || payload.state === "failed" || payload.state === "blocked" || payload.state === "canceled") {
          terminalStateSeen = true;
          clearTimers();
          child.stdin?.end();
          return;
        }
      }
      resetIdleTimer();
    };
    const emitTerminal = (data: string) => {
      terminalQueue.push(data);
      queue.push(terminalEvent(input, data));
      resetIdleTimer();
    };

    wallClockTimer = setTimeout(() => tripWatchdog("wall_clock_timeout"), input.timeouts.wall_clock_max_ms);
    wallClockTimer.unref?.();
    resetIdleTimer();
    emitEvent(statusEvent(input, "initializing", `${this.vendor} CLI probe passed; process spawned.`, 0.05));
    const stdout = createCliStdoutConsumer(input, this.vendor, emitEvent, emitTerminal);
    child.stdout.on("data", (chunk) => stdout(String(chunk)));
    consumeStderr(input, child, emitEvent, emitTerminal);

    const closed = new Promise<{ exitCode: number | null; signalCode: NodeJS.Signals | null }>((resolve) => {
      child.on("error", (error) => {
        emitEvent(errorEvent(input, this.vendor, error.message, false));
      });
      child.on("exit", (exitCode, signalCode) => {
        clearTimers();
        if (!terminalStateSeen) {
          const finalState = blockedReason ? "blocked" : exitCode === 0 ? "done" : "failed";
          queue.push(statusEvent(
            input,
            finalState,
            blockedReason ?? (exitCode === 0
              ? `${this.vendor} CLI finished.`
              : `${this.vendor} CLI exited with ${exitCode ?? "unknown status"}.`),
            1
          ));
        }
        queue.push(createHarnessEvent(input, "worker.exit", "harness", {
          exit_code: exitCode,
          signal_code: signalCode
        }));
        terminalQueue.close();
        queue.close();
        resolve({ exitCode, signalCode });
      });
    });

    return {
      sessionId: input.session_id,
      pid: child.pid ?? null,
      events: () => queue,
      terminal: () => terminalQueue,
      write: async (data: string) => {
        child.stdin?.write(data);
      },
      cancel: async () => {
        child.kill("SIGTERM");
      },
      closed
    };
  }
}

export class ClaudeCliHarnessAdapter extends CliHarnessAdapter {
  readonly kind = "claude-code-cli";
  protected readonly vendor = "claude" as const;
}

export class CodexCliHarnessAdapter extends CliHarnessAdapter {
  readonly kind = "codex-cli";
  protected readonly vendor = "codex" as const;
}

export class StubHarnessAdapter implements HarnessAdapter {
  readonly kind = "stub-harness";
  readonly runtimeKind = "local" as const;

  async launch(input: HarnessLaunch): Promise<RunningHarness> {
    const queue = new AsyncQueue<WardEvent>();
    const terminalQueue = new AsyncQueue<string>();
    const workerEntry = join(import.meta.dir, "stub-worker.ts");
    let watchdogTripped = false;
    let wallClockTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const ptyBridge = join(import.meta.dir, "pty-bridge.cjs");
    const child = spawn(input.mode === "visible" ? "node" : process.execPath, input.mode === "visible" ? [ptyBridge, process.execPath, workerEntry] : [workerEntry], {
      cwd: input.working_dir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        WARD_SESSION_ID: input.session_id,
        WARD_SCENARIO: input.scenario,
        WARD_ARTIFACTS_DIR: join(input.mcp_overlay_path, "..", "artifacts"),
        WARD_TRACE_ID: input.context_packet.trace_id
      }
    });

    const clearTimers = () => {
      if (wallClockTimer) {
        clearTimeout(wallClockTimer);
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
    };
    const tripWatchdog = (kind: "wall_clock_timeout" | "idle_timeout") => {
      if (watchdogTripped) {
        return;
      }
      watchdogTripped = true;
      clearTimers();
      const detail = kind === "idle_timeout"
        ? `No worker output for ${input.timeouts.idle_max_ms} ms.`
        : `Session exceeded ${input.timeouts.wall_clock_max_ms} ms wall-clock limit.`;
      queue.push(createEvent({
        event_type: "watchdog.timeout",
        trace_id: input.context_packet.trace_id,
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        source: "harness",
        payload: { kind, detail }
      }));
      queue.push(createEvent({
        event_type: "worker.status",
        trace_id: input.context_packet.trace_id,
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        source: "harness",
        payload: {
          type: "status",
          state: "blocked",
          detail,
          progress_pct: 1
        }
      }));
      child.kill("SIGTERM");
    };
    const resetIdleTimer = () => {
      if (watchdogTripped) {
        return;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => tripWatchdog("idle_timeout"), input.timeouts.idle_max_ms);
      idleTimer.unref?.();
    };
    const emitEvent = (event: WardEvent) => {
      queue.push(event);
      if (event.event_type === "worker.status") {
        const payload = event.payload as { state?: unknown };
        if (payload.state === "done" || payload.state === "failed" || payload.state === "blocked" || payload.state === "canceled") {
          clearTimers();
          child.stdin?.end();
          return;
        }
      }
      resetIdleTimer();
    };
    const emitTerminal = (data: string) => {
      terminalQueue.push(data);
      queue.push(createEvent({
        event_type: "worker.terminal",
        trace_id: input.context_packet.trace_id,
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        source: "harness",
        payload: { data }
      }));
      resetIdleTimer();
    };

    wallClockTimer = setTimeout(() => tripWatchdog("wall_clock_timeout"), input.timeouts.wall_clock_max_ms);
    wallClockTimer.unref?.();
    resetIdleTimer();
    consumeStdout(input, child, emitEvent, emitTerminal);
    consumeStderr(input, child, emitEvent, emitTerminal);

    const closed = new Promise<{ exitCode: number | null; signalCode: NodeJS.Signals | null }>((resolve) => {
      const onExit = (exitCode: number | null, signalCode: NodeJS.Signals | null) => {
        clearTimers();
        queue.push(createEvent({
          event_type: "worker.exit",
          trace_id: input.context_packet.trace_id,
          workspace_id: input.workspace_id,
          session_id: input.session_id,
          source: "harness",
          payload: { exit_code: exitCode, signal_code: signalCode }
        }));
        terminalQueue.close();
        queue.close();
        resolve({ exitCode, signalCode });
      };
      child.on("exit", onExit);
    });

    return {
      sessionId: input.session_id,
      pid: child.pid ?? null,
      events: () => queue,
      terminal: () => terminalQueue,
      write: async (data: string) => {
        child.stdin?.write(data);
      },
      cancel: async () => {
        child.kill("SIGTERM");
      },
      closed
    };
  }
}
