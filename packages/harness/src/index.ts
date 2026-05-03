import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  StubWorkerEnvelopeSchema,
  createEvent,
  type HarnessAdapter,
  type HarnessLaunch,
  type StubWorkerEnvelope,
  type WardEvent
} from "@ward/core";

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
