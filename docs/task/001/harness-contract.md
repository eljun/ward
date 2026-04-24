# Appendix: Harness Contract

The Harness is the Runtime subsystem that launches, monitors, and terminates
worker processes (Codex, Claude Code, future workers). It standardizes how
workers are invoked, how they report progress, and how their output becomes
events and artifacts.

## Design Principles

1. **CLI-wrap by default.** Claude Code and Codex are the primary workers,
   both wrapped as CLI subprocesses using the user's subscription auth. Agent
   SDKs and raw API are opt-in alternatives available through the Brain
   Registry `runtime` field.
2. **Two modes, one contract.** Visible (PTY) and headless (piped stdio)
   modes share the same contract inputs and emit the same event types.
3. **Deterministic state machine.** A small high-level state machine sits
   above the raw event stream and drives the UI. Events are fine-grained;
   states are coarse.
4. **Defensive parsing.** The Runtime never trusts worker output to be
   valid. Malformed status emits degrade gracefully to `unknown`, never
   crash.
5. **Recoverable.** Harness sessions survive Runtime restarts where the
   underlying worker supports it (stdio can be reattached via saved
   metadata; PTY sessions have a reattach path).

## Harness Launch Contract

A harness run is launched with this input schema (Zod-validated at boundary):

```ts
type HarnessLaunch = {
  session_id: string;            // uuid
  workspace_id: number;
  task_id: number | null;
  brain_id: string;              // from Brain Registry
  runtime_kind: "cli" | "sdk" | "api" | "local";
  mode: "visible" | "headless";
  working_dir: string;           // absolute path
  task_contract: TaskContract;   // see below
  context_packet: ContextPacket; // assembled by Runtime
  allowed_tools: string[];       // MCP tool names scoped for this run
  mcp_overlay_path: string;      // generated .mcp.json path for this run
  timeouts: {
    wall_clock_max_ms: number;
    idle_max_ms: number;         // no output for this long → watchdog
  };
  autonomy_level: "strict" | "standard" | "lenient";
  created_at: string;            // ISO8601
};
```

### Task Contract

```ts
type TaskContract = {
  goal: string;                  // 1–3 sentences
  constraints: string[];         // bullet list, hard rules
  acceptance_criteria: string[]; // bullet list
  reporting_format: "stream-json" | "markdown" | "structured";
  max_iterations?: number;       // optional hard cap
};
```

### Context Packet

```ts
type ContextPacket = {
  workspace_summary: string;     // from warm cache
  recent_sessions: string[];     // summaries
  relevant_wiki_refs: Array<{ page: string; excerpt: string }>;
  active_blockers: string[];
  repo_snapshot_ref: string;     // path to cached snapshot
  preferences_excerpt: object;   // only prefs relevant to this run
  trace_id: string;
};
```

The Runtime assembles the packet from the warm cache. Assembly is
event-driven, not on-demand — see `warm-start.md`.

## Runtime Kinds

### `cli` (default for Claude Code and Codex)

- Spawns the vendor CLI as a child process.
- **Headless**: invoked as `claude -p "<prompt>" --output-format stream-json`
  (or Codex equivalent). Runtime pipes stdout, parses JSON events line by
  line, maps them to WARD event types. Uses existing CLI auth. No API key
  required.
- **Visible**: spawned under `node-pty`. Runtime multiplexes the PTY to a
  WebSocket for the UI terminal pane and simultaneously tees to a
  session-scoped raw capture file. User can attach, detach, or take over.
- MCP registry is handed to the CLI via a generated overlay file pointed at
  by env var (the CLI's native `.mcp.json` resolution path). Workers
  inherit the Runtime's effective MCP set automatically.

### `sdk`

- Uses the vendor's Agent SDK in-process.
- API-keyed. Secret resolved from keychain at call time.
- Events produced by the SDK are adapted to WARD event types.
- Used when CLI is unavailable or when finer control is needed.

### `api`

- Direct HTTP API calls (Messages API for Anthropic, Responses for OpenAI).
- Runtime implements the agentic loop (tool-call dispatch, retry).
- Lowest level, most control, most implementation cost. Not default.

### `local`

- OpenAI-compatible HTTP endpoint. Runtime treats it identically to `api`
  but with no billing and optional auth.
- Useful for the Orchestrator Brain and lightweight assistants, not typically
  for full coding workers.

## Worker Status Protocol

Workers **must** emit structured status markers so the Runtime can drive the
lifecycle state machine. The Runtime never infers state from free-form text.

### Stream-JSON Runtime (`cli` with `stream-json` output)

Claude Code and Codex already emit typed events in stream-json mode. The
Runtime adapter reads:

- `assistant.message_start` / `content_block_*` / `message_stop`
- `tool_use` / `tool_result`
- `thinking` (if enabled)
- custom status tool calls (see below)

### Status Tool Contract

Workers are instructed (via system prompt injected by the harness) to call a
synthetic tool `ward.status` at lifecycle transitions. The tool is registered
via WARD-as-MCP-server.

```json
{
  "name": "ward.status",
  "arguments": {
    "state": "initializing | implementing | testing | creating_artifacts | awaiting_approval | done | failed | blocked",
    "detail": "short human-readable",
    "progress_pct": 0.0
  }
}
```

The Runtime also accepts a fallback stdout marker for workers that don't
support tool calls:

```
<<WARD_STATUS state=testing detail="pytest running" pct=0.4>>
```

Malformed markers are logged but ignored.

## Lifecycle State Machine

States (high-level, above the raw event stream):

```
queued
  ↓
initializing   ←───── reattach after Runtime restart
  ↓
implementing  ⇄  testing  ⇄  creating_artifacts
  ↓
  ├─ awaiting_approval (if autonomy or worker gated)
  │    ↓
  │    (approve/deny → back to prior state or → failed)
  ↓
done  |  failed  |  blocked
```

Transition rules:

- `queued → initializing`: launcher has spawned the worker and auth is
  verified.
- `initializing → implementing`: first `ward.status state=implementing` or
  first meaningful output.
- `implementing ↔ testing ↔ creating_artifacts`: per worker reports.
- `any → awaiting_approval`: worker calls a gated tool OR autonomy level
  demands approval before a tool class. Triggers Orchestrator Intervention
  mode.
- `any → blocked`: watchdog timeout, idle timeout, or Brain sanity check
  determines no progress.
- `any → failed`: non-zero exit, unrecoverable error event.
- `any → done`: worker emits `ward.status state=done` AND exits 0.

Each transition writes a `session_event` of type `state_changed` with old
and new state.

## Watchdog

Runs per session. Triggers:

- **Wall clock**: `wall_clock_max_ms` reached.
- **Idle**: `idle_max_ms` without any emitted event.
- **Sanity check** (optional, cost-gated): every N minutes in `implementing`
  state, Brain reviews recent events and returns a progress score. Score
  below threshold for K consecutive checks → `blocked`.

Blocked sessions trigger Intervention mode with options: resume, extend
timeout, abort, hand off to user.

## Artifact Capture

Every session writes to `~/.ward/sessions/<session_id>/`:

- `task-contract.json`
- `context-packet.json`
- `mcp-overlay.json`
- `events.ndjson` — full event stream
- `pty.raw` (visible mode only) — full byte capture
- `artifacts/` — worker-produced files (diffs, PR URLs, logs)
- `summary.md` — written by Orchestrator Post-session mode

Retention is a user preference (default: keep indefinitely, allow manual
purge via `ward session prune`).

## Allowed Tools

The `allowed_tools` field narrows the MCP tool set for a specific run. The
worker gets its effective MCP registry but tool calls outside `allowed_tools`
are **rejected by the Runtime's MCP proxy** before reaching the real MCP
server. This enforces autonomy policy at the tool layer.

Default `allowed_tools` per workspace autonomy level is declared in
`mcp-registry.md`.

## Concurrency and Queues

- **Per-workspace serial queue**: default; prevents two harnesses from
  stomping the same repo.
- **Global concurrency cap** (preference, default 2).
- **Per-provider concurrency cap** (from Brain Registry `concurrency_cap`):
  honors subscription limits (e.g., Claude Code concurrent sessions).

If a launch exceeds any cap, the session stays `queued` with a reason, and
the queue view shows what it's waiting on.

## Failure Modes

| Failure | Detection | Recovery |
|---|---|---|
| Worker non-zero exit | exit code ≠ 0 | mark `failed`, run Post-session mode |
| Worker hang | idle watchdog | mark `blocked`, Intervention |
| Runtime crash | PID check on startup | reattach where possible, else mark `blocked` |
| MCP server crash | stderr + exit | proxy logs error, retries with backoff, Intervention if persistent |
| Brain unavailable | adapter error | router falls back; if no fallback, mark `blocked` |
| CLI auth expired | spawn-time probe | Intervention asking user to re-authenticate vendor CLI |

## Testing

- Simulated worker adapter that emits canned stream-json events.
- Contract tests: every event type must parse into a typed object.
- State-machine tests: transitions pass fuzzed event sequences without
  illegal states.
- Reattach test: kill the Runtime mid-session, restart, verify state recovers.
