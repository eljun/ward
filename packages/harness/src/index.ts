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
  return createEvent({
    event_type: "mcp.tool_denied",
    trace_id: launch.context_packet.trace_id,
    workspace_id: launch.workspace_id,
    session_id: launch.session_id,
    source: "mcp",
    payload: envelope
  });
}

function consumeStdout(
  launch: HarnessLaunch,
  child: { stdout: NodeJS.ReadableStream },
  emitEvent: (event: WardEvent) => void
): void {
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += String(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
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
  });
}

function consumeStderr(
  launch: HarnessLaunch,
  child: { stderr: NodeJS.ReadableStream },
  emitEvent: (event: WardEvent) => void
): void {
  let buffer = "";
  child.stderr.on("data", (chunk) => {
    buffer += String(chunk);
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
    const workerEntry = join(import.meta.dir, "stub-worker.ts");
    let watchdogTripped = false;
    let wallClockTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(process.execPath, [workerEntry], {
      cwd: input.working_dir,
      stdio: ["ignore", "pipe", "pipe"],
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
      resetIdleTimer();
    };

    wallClockTimer = setTimeout(() => tripWatchdog("wall_clock_timeout"), input.timeouts.wall_clock_max_ms);
    wallClockTimer.unref?.();
    resetIdleTimer();
    consumeStdout(input, child, emitEvent);
    consumeStderr(input, child, emitEvent);

    const closed = new Promise<{ exitCode: number | null; signalCode: NodeJS.Signals | null }>((resolve) => {
      child.on("exit", (exitCode, signalCode) => {
        clearTimers();
        queue.push(createEvent({
          event_type: "worker.exit",
          trace_id: input.context_packet.trace_id,
          workspace_id: input.workspace_id,
          session_id: input.session_id,
          source: "harness",
          payload: { exit_code: exitCode, signal_code: signalCode }
        }));
        queue.close();
        resolve({ exitCode, signalCode });
      });
    });

    return {
      sessionId: input.session_id,
      pid: child.pid ?? null,
      events: () => queue,
      cancel: async () => {
        child.kill("SIGTERM");
      },
      closed
    };
  }
}
