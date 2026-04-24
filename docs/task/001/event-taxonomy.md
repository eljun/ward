# Appendix: Event Taxonomy

WARD is an event-driven system. Every meaningful change in the Runtime emits
a typed event. The event bus has four consumers: SQLite (persistence), SSE
(UI push), warm-cache invalidation, and the Orchestrator Brain (mode
selection).

This document defines the canonical event types and their payload schemas.
All events share a base envelope; the `payload` field is typed per
`event_type`.

## Base Envelope

```ts
type WardEvent = {
  event_id: string;         // uuid
  event_type: string;       // see catalog below
  trace_id: string;         // propagated across related events
  timestamp: string;        // ISO8601 UTC
  workspace_id: number | null;
  session_id: string | null;
  source: "runtime" | "harness" | "orchestrator" | "mcp" | "user" | "inbound" | "scheduler";
  payload: unknown;         // typed per event_type
  version: 1;
};
```

Every event is persisted to `session_events` (or `system_events` when
`session_id` is null) as one NDJSON-like row with the payload serialized as
JSON. The `version` field allows future schema evolution.

## Event Categories

### Session Lifecycle

| `event_type` | When | Payload |
|---|---|---|
| `session.queued` | launch accepted, waiting for slot | `{reason}` |
| `session.started` | worker process spawned | `{pid, brain_id, runtime_kind, mode}` |
| `session.state_changed` | lifecycle transition | `{from, to, reason}` |
| `session.completed` | terminal success | `{exit_code, duration_ms}` |
| `session.failed` | terminal failure | `{exit_code, error, duration_ms}` |
| `session.blocked` | watchdog or sanity-check gate | `{reason, suggested_actions[]}` |
| `session.reattached` | Runtime recovered a running session | `{previous_state}` |

### Worker Output

| `event_type` | When | Payload |
|---|---|---|
| `worker.message` | worker emitted assistant text | `{text, partial: bool}` |
| `worker.thinking` | worker emitted thinking (if enabled) | `{text}` |
| `worker.tool_call` | worker called a tool | `{tool_name, arguments, allowed: bool}` |
| `worker.tool_result` | tool result received | `{tool_name, result, error?}` |
| `worker.status_update` | `ward.status` call or fallback marker | `{state, detail, progress_pct}` |
| `worker.needs_permission` | gated tool call paused | `{tool_name, arguments, reason}` |
| `worker.error` | worker reported an error | `{error, recoverable: bool}` |

### File and Repo

| `event_type` | When | Payload |
|---|---|---|
| `fs.file_written` | worker wrote a file | `{path, bytes, diff_summary?}` |
| `fs.file_deleted` | worker deleted a file | `{path}` |
| `git.commit` | commit detected in linked repo | `{repo, sha, message, author, files_changed}` |
| `git.branch_changed` | branch changed | `{repo, old, new}` |
| `git.push` | push detected | `{repo, remote, branch, commits}` |
| `git.pr_opened` | PR detected via MCP | `{repo, number, url, title}` |
| `git.pr_status_changed` | CI or review state change | `{repo, number, state, checks_summary}` |
| `git.pr_merged` | PR merged | `{repo, number, url, merged_by}` |

### Plan Mode

| `event_type` | When | Payload |
|---|---|---|
| `plan.started` | Plan Mode opened | `{plan_id, workspace_id, participants[]}` |
| `plan.round_started` | round advance | `{plan_id, round, prompt}` |
| `plan.participant_output` | a participant's round output | `{plan_id, round, brain_id, content}` |
| `plan.synthesis` | moderator round synthesis | `{plan_id, round, content}` |
| `plan.decision` | Plan Mode decision written | `{plan_id, packet_version}` |
| `plan.aborted` | Plan Mode canceled | `{plan_id, reason}` |

### Notification / Remote

| `event_type` | When | Payload |
|---|---|---|
| `notify.queued` | Runtime decided to send a notification | `{channel, priority, title}` |
| `notify.sent` | channel confirmed send | `{channel, external_id}` |
| `notify.failed` | send failed | `{channel, error}` |
| `inbound.received` | user message arrived from Slack / Telegram | `{channel, external_user_id, text}` |
| `inbound.command` | parsed inbound command | `{channel, command, params, approved: bool}` |
| `inbound.rejected` | inbound rejected (allowlist / signature / destructive) | `{channel, reason}` |

### MCP

| `event_type` | When | Payload |
|---|---|---|
| `mcp.server_started` | MCP server spawned | `{server_id, scope, pid?}` |
| `mcp.server_exited` | MCP server terminated | `{server_id, exit_code}` |
| `mcp.tool_invoked` | tool call dispatched | `{server_id, tool, trace_id}` |
| `mcp.tool_result` | tool returned | `{server_id, tool, duration_ms, error?}` |
| `mcp.tool_denied` | denied by allowlist / autonomy | `{server_id, tool, reason}` |

### Brain / Cost

| `event_type` | When | Payload |
|---|---|---|
| `brain.call_started` | Runtime invoked a brain | `{brain_id, mode, trace_id}` |
| `brain.call_completed` | brain returned | `{brain_id, mode, tokens_in?, tokens_out?, dollars?, duration_ms}` |
| `brain.call_failed` | brain call errored | `{brain_id, mode, error, fallback_used}` |
| `cost.cap_warning` | approaching cap | `{brain_id, current, cap}` |
| `cost.cap_exceeded` | cap hit | `{brain_id, fallback_brain_id}` |

### User / Presence

| `event_type` | When | Payload |
|---|---|---|
| `user.message` | user typed | `{text, surface: "ui" \| "slack" \| "telegram"}` |
| `user.approval` | user responded to Intervention | `{intervention_id, decision, note?}` |
| `presence.changed` | presence state transitioned | `{from, to, source}` |

### System

| `event_type` | When | Payload |
|---|---|---|
| `runtime.started` | daemon up | `{version, port, pid}` |
| `runtime.stopping` | graceful shutdown | `{reason}` |
| `runtime.crashed` | restart detected | `{previous_uptime_ms}` |
| `warmcache.refreshed` | warm cache key rebuilt | `{key, reason, duration_ms}` |
| `doctor.issue` | `ward doctor` flagged something | `{check, severity, detail}` |
| `backup.completed` | nightly backup finished | `{path, size_bytes}` |
| `anomaly.detected` | Silent mode or watchdog flagged anomaly | `{kind, detail, severity}` |

## Consumers

| Consumer | Subscribes to |
|---|---|
| **SQLite persistence** | all events with `session_id` → `session_events`; all others → `system_events` |
| **SSE to UI** | session, worker, plan, git, notify, brain, presence |
| **Warm cache invalidator** | `git.*`, `session.completed`, `plan.decision`, `fs.file_written`, `presence.changed` |
| **Orchestrator mode selector** | `worker.needs_permission`, `session.blocked`, `session.completed`, `session.failed`, `plan.round_started`, `notify.queued`, `user.message`, `inbound.received` |
| **Cost ledger** | `brain.call_completed`, `brain.call_failed` |
| **Audit log** | all events (full NDJSON dump) |

## Event Emission Rules

1. **Every state transition emits exactly one event.** No implicit state
   changes.
2. **Events are append-only.** Correcting history is done with a
   compensating event, never editing persisted events.
3. **Payloads are validated at the emit boundary** with Zod. Invalid events
   are dropped with a `system.event_invalid` instead of crashing.
4. **Large payloads are offloaded.** Raw PTY bytes, full diffs, full
   stream-json dumps do not live in the event. They are written to
   `sessions/<id>/` and the event carries a file reference.
5. **Redaction runs before emission** on any payload field that may contain
   secrets. See `security-model.md` for the redaction list.

## Versioning

The envelope carries `version: 1`. Future non-backwards-compatible changes
bump the version and the persistence layer keeps old rows readable.
Consumers declare which versions they handle; unknown versions are logged
and skipped.
