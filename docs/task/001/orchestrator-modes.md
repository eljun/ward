# Appendix: Orchestrator Modes

The Orchestrator Brain runs in exactly one of seven modes at any given call.
Each mode has a distinct prompt template, context recipe, output contract,
and trigger. Modes are selected by the Runtime (deterministic) based on the
event that triggered the Brain call — never self-selected by the Brain.

This makes behavior testable: you can unit-test mode selection without
calling an LLM.

## Mode Catalog

| Mode | Trigger | Blocking? | Default verbosity | Output contract |
|---|---|---|---|---|
| **Conversational** | User types in UI / remote channel | interactive | free-form streaming | Markdown stream with optional `speak` flag |
| **In-session commentary** | Harness emits milestone event AND user has commentary enabled | non-blocking | terse (1 line) | single-line status |
| **Intervention** | Harness emits `needs_permission` or `blocked` | **blocking** | structured | `{ask, options[], recommended, reason}` |
| **Post-session** | Harness emits `completed` or `failed` | non-blocking | structured | outcome card + wiki delta + handoff draft |
| **Moderator** | Plan Mode active, round transition | turn-based | structured per round | round-specific schema (see `plan-packet-schema.md`) |
| **Alert composer** | Notification pipeline queued a send | non-blocking | concise | `{channel, priority, title, body, actions[]}` |
| **Silent / background** | Indexer, summarizer, log rollup | non-blocking | none (no prose unless anomaly) | structured output or empty |
| **Action** | User utterance parsed to include actionable intent (e.g., "delegate X to Codex") | interactive | structured | `{actions[], clarifications[]}` |

*Note: Action mode is functionally a sub-mode of Conversational but runs a
different output contract. Runtime picks it when the Conversational input is
classified as containing an actionable verb.*

## Conversational Mode

**Trigger**: user submits a message through UI, Slack DM, or Telegram.

**Context recipe**:
- user profile (name, timezone, persona)
- current workspace summary (if one is selected)
- last N session summaries for that workspace
- top-K relevant wiki pages (from warm cache)
- active blockers
- recent 5 conversational turns

**Output contract**:
- Markdown, streamed.
- Optional `speak: true` flag on short messages for browser TTS.
- May call MCP tools (subject to autonomy level).

**SLA**: first token under 500 ms (warm cache assumed).

## In-Session Commentary Mode

**Trigger**: harness event of type `state_changed` or `milestone_reached` AND
the user has `live_commentary` enabled for this session.

**Context recipe**: last state transition, last 3 milestone events, session
summary so far.

**Output contract**: single line, ≤ 80 chars, terse. Example: "Codex finished
scaffolding auth routes, tests starting."

Default off. Opt-in per-session or via preference.

## Intervention Mode

**Trigger**: harness emits `needs_permission` (tool call gated by autonomy
level) or `blocked` (watchdog detected stall).

**Context recipe**: the pending tool call or blocker, the task contract, the
last 10 events, the autonomy level.

**Output contract** (strict JSON):

```json
{
  "ask": "short question to user",
  "options": [
    { "id": "approve", "label": "Approve", "effect": "proceed" },
    { "id": "reject",  "label": "Deny",    "effect": "abort" },
    { "id": "modify",  "label": "Edit and approve", "effect": "custom" }
  ],
  "recommended": "approve",
  "reason": "short explanation"
}
```

**Routing**: if user is present → UI modal. If away → Alert composer mode
formats it for Slack/Telegram with inline action buttons. Both paths produce
the same `approved | rejected | modified` decision that resumes the harness.

**Blocking**: yes. Harness stays paused until decision or timeout.

## Post-Session Mode

**Trigger**: harness emits `completed` or `failed`.

**Context recipe**: full session event list, final artifacts (diffs, PR URL,
logs), task contract, prior wiki state for the workspace.

**Output contract** (strict JSON):

```json
{
  "outcome": "success | partial | failed",
  "summary": "1–3 sentences",
  "key_changes": ["...", "..."],
  "artifacts": [{ "kind": "pr", "url": "..." }, ...],
  "blockers": ["..."],
  "wiki_delta": [
    { "page": "sessions.md", "action": "append", "content": "..." },
    { "page": "decisions.md", "action": "append", "content": "..." }
  ],
  "handoff": "next-step card, 1–2 sentences",
  "should_notify": true,
  "notify_priority": "low | normal | high"
}
```

Runtime applies the `wiki_delta`, writes the handoff, and routes notifications
per the `should_notify` decision and presence state.

## Moderator Mode

**Trigger**: Plan Mode round transitions.

**Context recipe**: Plan Mode state, all participant outputs for the active
round, attached documents.

**Output contract**: round-specific, per `plan-packet-schema.md`.

## Alert Composer Mode

**Trigger**: notification pipeline receives a payload to send via a remote
channel.

**Context recipe**: event summary, user profile (timezone / work hours /
quiet hours), priority, channel.

**Output contract**:

```json
{
  "channel": "slack | telegram | email",
  "priority": "low | normal | high",
  "title": "short",
  "body": "concise, actionable",
  "actions": [
    { "id": "view", "label": "Open", "url": "..." },
    { "id": "approve", "label": "Approve", "callback": "..." }
  ]
}
```

## Silent / Background Mode

**Trigger**: scheduled maintenance, indexing, summarizing, log rollup, warm
cache refresh.

**Output contract**: structured artifacts only (index updates, summaries
written to wiki). No prose visible to user unless an anomaly is detected, in
which case the Brain emits an `anomaly_detected` event that is routed to the
normal Alert pipeline.

## Action Mode

**Trigger**: Conversational input classified as containing actionable intent
by a lightweight classifier (regex + small-model check).

**Context recipe**: same as Conversational, plus the full current task list
and workspace list for ID resolution.

**Output contract** (strict JSON):

```json
{
  "actions": [
    {
      "kind": "delegate | approve | reject | note | start_plan_mode | open_workspace | ...",
      "params": { ... },
      "confidence": 0.0–1.0
    }
  ],
  "clarifications": [
    { "question": "...", "needed_for": "action index 0" }
  ],
  "confirm_before_execute": true | false
}
```

If `confirm_before_execute` is true or any action has confidence below a
threshold, the Runtime replays a confirmation turn before execution.

## Autonomy Levels (cross-cutting)

Autonomy level is per-workspace (with global default). It controls when
Intervention mode fires and how Action mode's `confirm_before_execute`
defaults are set.

| Level | Auto-permitted | Requires approval |
|---|---|---|
| **strict** | reads, summaries | any write, any PR, any destructive action |
| **standard** *(default)* | reads, summaries, file writes within workspace repo, PR creation | PR merge, branch deletion, force push, dependency removal, anything outside workspace repo |
| **lenient** | everything above plus PR merge when CI green | force push to protected branches, repository deletion |

Autonomy level also feeds the MCP tool-class approval matrix (see
`mcp-registry.md`).

## Presence-Aware Routing

Presence state (`present | away | dnd`) is computed by:

1. UI heartbeat within last 2 min → `present`.
2. Explicit `ward presence away` command → `away`.
3. Scheduled quiet hours from user profile → `dnd`.
4. No heartbeat for ≥ 5 min → `away`.

Effects on modes:

- Intervention mode: present → UI modal; away → Alert composer to Slack/Telegram; dnd → queue until present unless priority `high`.
- Post-session mode: present → UI toast; away → Alert composer if
  `should_notify`; dnd → queue unless `high`.
- Alert composer mode: dnd gates to `high` only by default.

## Mode Selection Logic (reference)

Runtime selects mode using this table. The Brain never picks its own mode.

```
trigger                               → mode
-----------------------------------------------
user_message (UI/remote)              → Conversational or Action (classifier)
harness.state_changed (milestone)     → In-session commentary (if enabled)
harness.needs_permission              → Intervention
harness.blocked                       → Intervention
harness.completed / failed            → Post-session
plan_mode.round_advance               → Moderator
notification.queued                   → Alert composer
scheduled.maintenance                 → Silent / background
```

## Testing Contracts

Every mode must have:

- Fixture transcripts for selection (given event X, selects mode Y).
- Contract tests that validate output JSON against its schema.
- A simulated brain adapter that returns canned responses per mode, for
  end-to-end UI testing without real LLM cost.
