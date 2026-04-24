# Task 007: Harness Abstraction, Lifecycle, and Watchdog

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 002, 003

## Summary

Implement the harness layer per `001/harness-contract.md` with a stubbed
worker. Visible (PTY) and headless (piped stdio) modes share the same
launch contract and emit the same event types. Includes the lifecycle state
machine, worker status protocol, watchdog, artifact capture, and per-run
tool allowlist enforcement.

This task does not wire real Codex / Claude Code yet — that lands in 008.
The stubbed worker emits canned stream-json events so the full pipeline can
be exercised end-to-end.

## In Scope

### Harness launcher

- Accepts `HarnessLaunch` (Zod-validated).
- Picks per-workspace serial queue; honors global concurrency cap.
- Spawns worker process per `runtime_kind`:
  - `cli` headless: piped stdio, parses stream-json
  - `cli` visible: `node-pty` PTY, multiplexed to WebSocket + tee to file
  - `local` / `api` / `sdk`: stubbed in this task; full impl in 008
- Writes:
  - `~/.ward/sessions/<session_id>/task-contract.json`
  - `~/.ward/sessions/<session_id>/context-packet.json`
  - `~/.ward/sessions/<session_id>/mcp-overlay.json` (stub for now;
    overlay generation lands in 009)
  - `events.ndjson`
  - `pty.raw` (visible only)
  - `artifacts/`

### Lifecycle state machine

- States and transitions per `001/harness-contract.md`.
- Emits `session.state_changed` on every transition.
- Persists state to `session` row.
- Reattach path: on Runtime startup, scan in-flight sessions and either
  reattach (where worker process is alive) or mark `blocked` with reason.

### Worker status protocol

- Stream-json adapter that maps Claude Code / Codex events to WARD events.
- Synthetic `ward.status` tool (registered through WARD-as-MCP-server stub
  in this task; full registration lands in 009).
- Stdout fallback marker parser:
  `<<WARD_STATUS state=... detail="..." pct=...>>`
- Malformed status: log + emit `worker.status_invalid`, never crash.

### Watchdog

- Wall-clock timeout per launch.
- Idle timeout per launch.
- Optional Brain sanity check (cost-gated, off by default).
- On trip: emit `session.blocked`, trigger Intervention mode (mocked in
  this task; real routing in 008 once Brain is real).

### Allowed tools enforcement

- MCP proxy interface (full impl in 009) accepts an `allowed_tools` filter.
- This task ships the filter API and rejects out-of-allowlist calls with a
  synthetic `tool_not_allowed` result.

### Stub worker

- Bun-based fake worker that emits scripted stream-json events from a YAML
  scenario file: state transitions, fake tool calls, fake messages, fake
  completion or failure.
- Used for end-to-end tests and for UI demo without external deps.

### API

- `POST /api/sessions` — launch
- `GET /api/sessions` — list with filters (workspace, state)
- `GET /api/sessions/:id` — detail + recent events
- `GET /api/sessions/:id/events` (SSE) — live event stream
- `POST /api/sessions/:id/cancel`
- `POST /api/sessions/:id/answer-intervention` — { decision, note }
- `WS /api/sessions/:id/pty` — PTY byte stream (visible only)

### CLI

- `ward session launch <workspace-slug> --task <id> [--mode visible|headless]`
- `ward sessions [--workspace ...] [--state ...]`
- `ward session show <id>`
- `ward session tail <id>` (live event stream)
- `ward session attach <id>` (visible-mode terminal attach)
- `ward session cancel <id>`

### UI

- Sessions list with state badges + workspace + brain
- Session detail:
  - Lifecycle timeline (states with timestamps)
  - Event log (filterable)
  - Artifact list with download
  - Visible-mode terminal pane (xterm.js)
  - Intervention modal when state is `awaiting_approval`

## Out of Scope

- Real Codex / Claude Code adapters (008)
- Real MCP integration (009)
- GitHub PR creation, etc. (008 + 009)
- Cost ledger persistence (lands fully in 008)

## Acceptance Criteria

1. Stub worker runs end-to-end: launch → state transitions → completion;
   events persisted and streamed to UI.
2. Visible mode: terminal pane shows PTY output; user can attach and type
   (typing reaches the worker).
3. Idle timeout fires when stub worker pauses past threshold; session moves
   to `blocked`.
4. Disallowed tool call from stub worker is rejected with synthetic result;
   `mcp.tool_denied` event emitted.
5. Reattach: kill the Runtime mid-session, restart, session state recovers
   or moves to `blocked` with reason.
6. Per-workspace serial queue verified: launching two sessions on same
   workspace queues the second.
7. Global concurrency cap honored across workspaces.
8. Full event stream for a stub session matches the canonical event
   taxonomy.

## Deliverables

- Harness package in `packages/harness`
- Stub worker binary
- Scenario YAML schema + sample scenarios
- Migration `0007_session_lifecycle.sql` (lifecycle_state enum on session,
  trace_id on events)
- API + CLI + UI surfaces
- Reattach test suite

## Risks

- PTY reattach across Runtime restart is harder than headless; document
  "best-effort, falls back to blocked on missed signal".
- xterm.js performance with high-throughput PTY: throttle UI render at 30
  fps.
