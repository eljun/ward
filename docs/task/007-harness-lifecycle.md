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
machine, worker status protocol, watchdog, artifact capture, hard-memory
handoff, agent signal capture, and per-run tool allowlist enforcement.

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
  - `agent-signal.json`

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

### Agent contract scaffolding

- Load built-in agent manifests from
  [`001/agent-contract.md`](001/agent-contract.md):
  Planning, Coding, Quality Gate, QA, QA Supervisor, Documentation, and
  Reporting.
- Persist each launch's `AgentContextPacket` and final `AgentSignal`.
- Emit `agent.invoked`, `agent.signal`, and `agent.artifact_written`
  events.
- Do not implement real specialist intelligence yet; simulated agents
  return deterministic signals for acceptance tests. Real Claude/Codex and
  workflow-skills-backed runs land in 008.

### Hard-memory handoff

- Task docs, testing docs, evidence packets, events, and git diff summaries
  are treated as the durable source of truth between phases.
- Add parser helpers for stable task-doc sections:
  - `## WARD Metadata`
  - `## Agent Signals`
  - `## Implementation Claims`
  - `## QA Evidence`
  - `## Harness Critique`
  - `## Open Risks`
- Create or update the task evidence packet when a simulated agent writes a
  handoff artifact.

### Stub worker

- Bun-based fake worker that emits scripted stream-json events from a YAML
  scenario file: state transitions, fake tool calls, fake messages, fake
  completion or failure.
- Used for end-to-end tests and for UI demo without external deps.

### QA Supervisor stub

- Reads a canned task doc, fake `/test` report, and fake changed-file list.
- Produces a deterministic `agent.qa_reviewed` event.
- Marks evidence `needs_work` when a required acceptance criterion has no
  matching test evidence, even if the fake `/test` report says PASS.
- Writes the critique to the evidence packet and, when a repo task doc is
  present, to `## Harness Critique`.

### Harness extension seam

Implement the `HarnessAdapter` contract from
[`001/extension-seams.md`](001/extension-seams.md). Ship the simulated
adapter and the PTY / headless primitives; real adapters (Claude Code,
Codex, SDK, API) land in 008 by implementing the same interface.

### Incognito sessions

- New field on `HarnessLaunch`: `incognito: boolean` (default false).
- Effects when `true`:
  - Session events persist to SQLite but are marked `incognito=1`.
  - Handoff writer (005) does **not** update wiki for this session.
  - Session does not appear in default list queries; requires `--include-incognito`.
  - Search (004) excludes incognito sessions.
  - Outcomes from incognito sessions are excluded from the learning loop (011).
- Use case: quick exploratory tangents that shouldn't clutter memory.

### Undo / session revert

- New command: `ward session revert <id>` (and UI button).
- Semantics:
  - For file writes inside the linked repo: create a revert patch of the
    diff introduced by that session; apply to working tree; emit
    `session.reverted` event.
  - For PR creation: close the PR via GitHub MCP (destructive-gated).
  - For wiki writes: `git revert <commit>` on the wiki repo.
  - For outside-repo writes (via explicit approval): revert requires
    explicit confirmation; WARD lists the paths and asks.
- Records a reverse-outcome so learning doesn't penalize the original
  brain twice.

### Durable queue

- Per-workspace serial queue + global cap persist to SQLite (`queue_entry`
  table). `queued-but-not-started` sessions survive Runtime restart and
  resume on next boot.
- Queue position is observable via `ward queue` and in the UI Sessions
  sidebar.

### SSE backpressure

- Events flowing from a busy harness to the UI pass through an
  event-coalescing middleware:
  - `worker.message_delta` events coalesce up to 30 fps
  - `fs.file_written` events coalesce per-file within 200 ms
  - Other event types pass through
- Per-client max-rate; clients over cap get a `stream.throttled` marker
  and a brief pause; never dropped silently.

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
9. `agent.invoked`, `agent.signal`, and `agent.artifact_written` events
   persist for a simulated agent run.
10. QA Supervisor stub rejects a PASS test report that lacks evidence for
    one acceptance criterion; `agent.qa_reviewed` records the missing item.
11. Incognito session: no wiki update, not in default list, not in search,
   not in learning inputs.
12. `ward session revert` on a stub session with fake file writes
    restores the tree; emits `session.reverted`.
13. Queued session survives daemon restart and dequeues on next start.
14. Backpressure: high-throughput stub emits 10k events/s; UI client
    receives coalesced stream at or below its configured cap, no data
    loss on the persistence path.

## Deliverables

- Harness package in `packages/harness`
- Agent contract scaffolding in `packages/orchestration`
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
