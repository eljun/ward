# Task 016: Agentic Orb Conductor

- Status: `testing`
- Type: `feature`
- Version Impact: `minor`
- Priority: `medium-high`
- Depends on: 014, 015 (landed), 017 (recommended)
- Recommended Tier: `deep`

## Overview

Make the W.A.R.D orb chat understand multi-step requests like
"Add a task to add a /health endpoint to the brief workspace and
assign it to Claude Code" and execute them as a coordinated chain:
parse the intent into a structured plan, confirm with the user,
execute the steps through existing W.A.R.D endpoints, stream progress
back into the orb transcript, and report a final summary. The user's
framing during planning:

> "I think this makes the orb understand context eg: 'Add new X for
> project X and assigned assigned to Claude/Codex' orb then analysis
> and create the task, session, and assignment to harness. Gets back
> with an initial report, keeps track on progress."

Today the orb chat does two things:

- An explicit-nav escape hatch ("open sessions" → switch surface).
- A single streaming reply from the local Ollama brain.

This task adds an **action layer** on top: the orb can decide, with
the user's explicit confirmation, to call W.A.R.D APIs in sequence and
narrate the chain as it runs. The model is the *planner*; W.A.R.D is
the *executor* — the model never touches a side-effecting endpoint
directly.

## Why this is its own task

Task 015 stripped the home down to the orb. Task 014 made the orb
conversational. Task 017 makes the orb's context configurable. Without
this task, the orb can answer "what should I work on?" but cannot
*do* anything — the user still has to leave the home, open the launch
modal, and fill it in. Task 016 closes that loop so the orb is a real
peer developer who can take work off the user's plate.

## Requirements

### Action vocabulary (v1)

| Action | Maps to | Confirmation needed |
|---|---|---|
| `create_task` | `POST /api/tasks` | no (cheap, easy to undo) |
| `launch_session` | `POST /api/sessions` | **yes** (consumes brain time / quota) |
| `read_overview` | `GET /api/overview` | no |
| `read_session` | `GET /api/sessions/:id` | no |
| `read_workspace` | `GET /api/workspaces/:slug` | no |

Out of v1 (folded later): `update_task`, `attach_file`,
`switch_workspace`, `delete_*`. Anything destructive stays disallowed
until a follow-up task explicitly enables it.

### Plan representation

A plan is a small JSON object the model emits. The runtime validates
it with Zod and refuses to execute anything that doesn't validate.

```json
{
  "intent": "Add a /health endpoint task to brief and launch Claude on it",
  "needs_confirmation": true,
  "steps": [
    { "kind": "create_task",
      "args": { "workspace_slug": "brief", "title": "Add /health endpoint", "type": "feature", "priority": "high" } },
    { "kind": "launch_session",
      "args": { "workspace_slug": "brief", "task_ref": "$1.id", "brain_id": "claude-code-cli", "mode": "headless",
                "goal": "Add a /health endpoint to apps/api/src/index.ts and a passing test." } }
  ]
}
```

Notes on the schema:
- `task_ref: "$1.id"` references the result of step 1 — a tiny output
  binding. Keep this strictly numeric reference (`$N.field`); no
  general expressions in v1.
- `needs_confirmation` is set by the planner. Always force it `true`
  when the plan contains a `launch_session`. UI never auto-confirms
  expensive steps regardless of the model's flag.
- All `_slug` / `_id` fields must reference *existing* W.A.R.D entities.
  The runtime validates against the live data; hallucinated slugs are
  rejected with a clear error in the transcript.

### Mode selection

Reuse `POST /api/orb/chat/stream` from task 014. Add an optional
request body field `mode: "auto" | "chat" | "conductor"`:

- `chat` (default): existing behavior — streaming conversational reply.
- `conductor`: model is asked to emit a plan in the action vocabulary;
  runtime parses, validates, and either streams a confirmation request
  or starts executing.
- `auto`: heuristic — if the user message contains an action verb
  ("add", "launch", "create", "start", "make") and the orb's local
  brain confidently classifies it as actionable, switch to `conductor`;
  otherwise stay `chat`.

Server-side classifier for `auto` is a small first prompt that asks
the model: "Is this request a single conversational reply or a
multi-step action? Answer with one word: chat or conductor." Cheap
and fast.

### Confirmation flow

When a plan needs confirmation, the runtime emits these SSE frames:

```
event: plan_proposed
data: {"plan": <plan object>, "human_summary": "I'll create a task ... then launch a Claude Code session."}

event: done
data: {"trace_id": "...", "timestamp": "...", "awaits_confirmation": true}
```

The UI renders the `human_summary` as the assistant turn, plus an
inline confirmation pill row beneath it:

```
                [ ✓ Run plan ]   [ ✕ Cancel ]
```

Reuses the glass-modal aesthetic from task 015 styles, but as an
inline confirmation row rather than a centered modal. Cmd+Enter
confirms; Esc cancels.

On confirmation, the UI calls `POST /api/orb/conductor/execute` with
the plan. The execute endpoint returns an SSE stream:

```
event: step_started   data: {"step_index": 0, "kind": "create_task", "human": "Creating task 'Add /health endpoint'..."}
event: step_completed data: {"step_index": 0, "result": { "id": "task_abc", "title": "Add /health endpoint" } }
event: step_started   data: {"step_index": 1, "kind": "launch_session", ...}
event: step_completed data: {"step_index": 1, "result": { "session_id": "session_xyz", "lifecycle_state": "queued" } }
event: chain_completed data: {"summary": "Created task task_abc and launched Claude session session_xyz. Watching progress." }
event: done            data: {...}
```

Each `step_started` / `step_completed` lands as a transcript line
under the existing assistant turn (so the conversation reads as one
flowing reply, not five separate bubbles).

### Progress watcher

After `launch_session`, the conductor's response includes the new
session id. The home transcript subscribes to that session's existing
SSE event stream from task 014's wiring and renders compact progress
markers in the same conversation thread:

```
WARD: Started Claude session session_xyz. Watching…
   • initializing → implementing
   • implementing → testing
   • Session done. Wrote 1 file. Tap to inspect.
```

These are appended below the original assistant turn, not as new
bubbles, so the conversation stays cohesive. Tap → opens the terminal
dock to that session.

The watcher detaches when the session reaches a terminal state
(`done`, `failed`, `blocked`, `canceled`) or the user dismisses it.

### Error handling

- **Plan validation fails** (bad JSON, unknown action, hallucinated
  slug): show a friendly transcript line ("I drafted a plan but it
  references workspace `xyz` which doesn't exist. Try again with a
  real workspace name?"). Do not retry automatically.
- **Step fails mid-chain**: stop, report which step failed and why,
  don't roll back prior steps (the user can decide). The transcript
  shows partial completion clearly.
- **User cancels confirmation**: emit `chain_canceled` and end the
  stream cleanly. No state changes.
- **Model produces non-JSON**: one retry with a corrective prompt
  ("Reply with ONLY valid JSON in the schema."). On second failure,
  fall back to plain `chat` mode for that turn.

### System prompt extensions

The conductor mode uses a different system prompt than chat. Either:
- Two prompts swapped via `mode`, OR
- A single prompt with both behaviors and a small "if the user is
  asking you to act, emit JSON; otherwise reply in prose" rule.

Recommendation: **two distinct prompts**. The conductor prompt:

1. Lists the action vocabulary verbatim.
2. Provides 2–3 worked examples (few-shot) of valid plans.
3. Explicitly forbids hallucinating IDs/slugs. Points the model at the
   state context (workspaces, tasks, sessions) and tells it to pick
   from those.
4. Returns ONLY a JSON object matching the schema; no prose.

When task 017 lands, the chat prompt is configurable; the conductor
prompt is **not** user-configurable in v1 (it's tightly tied to the
action vocabulary). Future work: expose a "conductor persona" hint
that prepends the conductor prompt without breaking the schema.

### Glass modal vs inline confirmation

Use **inline confirmation** (within the transcript) for v1. Reasons:
- Keeps the conversation flowing.
- The confirmation has only two buttons; a full modal is heavy.
- Mirrors the chat-app pattern users already know.

Reserve the modal pattern for future destructive actions
(e.g. `delete_workspace`).

## Out of Scope (this task)

- Destructive actions (`delete_*`, `revert_*`, `force_*`).
- Generalized tool-use orchestration across multiple brains in one
  chain (e.g. "Claude do A, then have Codex review"). v1 chains are
  W.A.R.D-orchestrated, not multi-brain.
- Persistent multi-turn agent memory beyond the existing transcript.
- Speech-driven action triggering (microphone STT).
- Plan editing in the UI (e.g. "remove step 2"). v1 confirmation is
  binary: run as proposed or cancel.
- Rolling back partial chains on failure. v1 stops cleanly and reports.
- Sub-agents / sub-conductors (recursive plans). v1 plans are flat.
- Tool-calling via the brain's native function-call protocol. v1 uses
  JSON-mode replies, which is robust enough on `gemma4:e2b` and
  doesn't depend on uneven Ollama tool-calling support.
- Authentication beyond the existing W.A.R.D auth (no per-action
  authorization prompt — the user is already authenticated).

## Proposed File Changes

- `packages/core/src/orb/index.ts` (new) — Zod schemas for
  `OrbPlan`, `OrbStep`, action arg shapes per `kind`. Strictly typed
  so the runtime can both serialize and validate.
- `apps/runtime/src/index.ts`
  - Extend `POST /api/orb/chat/stream` to accept
    `mode?: "auto" | "chat" | "conductor"`.
  - Add a tiny `classifyOrbIntent(message)` that runs a non-streaming
    one-token "chat or conductor" classification when `mode === "auto"`.
  - Add `composeOrbConductorPrompt()` — distinct from the chat prompt;
    contains the action vocabulary and few-shot examples.
  - Parse and validate the model's JSON output. On invalid → one
    corrective retry, then fall back to `chat`.
  - Add `POST /api/orb/conductor/execute` (SSE) that takes a plan,
    re-validates server-side, executes step-by-step, emits
    `step_started` / `step_completed` / `chain_completed` /
    `chain_canceled` / `error`. Reuses internal calls to existing
    creation handlers (do not loop back through HTTP).
- `apps/ui/src/main.tsx`
  - Detect `plan_proposed` SSE events on `/api/orb/chat/stream` and
    render the inline confirmation row in the transcript.
  - On confirmation, call `/api/orb/conductor/execute` and append
    step events under the existing assistant turn.
  - On `launch_session` step result, attach a session-progress watcher
    using the existing SSE stream (from task 014). Compact in-thread
    progress markers, ending when the session reaches a terminal
    state.
  - Add Cmd+Enter / Esc handlers for the inline confirmation row.
- `apps/ui/src/styles.css`
  - Inline confirmation row styling (matches task 015 dark glass).
  - Step-progress markers within a turn (small, monospace, indented).
- `docs/task/016-…` and `TASKS.md` — slice tracking + Implementation
  Notes after the work lands.

No DB schema changes. No new packages.

## Code Context

- Orb chat stream endpoint: `apps/runtime/src/index.ts`
  `POST /api/orb/chat/stream` — added in 014 and slightly tuned in 015.
- System prompt builder: `composeOrbSystemPrompt()` in the runtime —
  becomes configurable in 017. Keep that path for `mode: "chat"`;
  add `composeOrbConductorPrompt()` for `mode: "conductor"`.
- Local brain dispatch: `streamOllamaChat()` and `ollamaChat()` from
  `@ward/harness/openai-compatible.ts` — both honor `keep_alive`,
  `think: false`, and accept arbitrary body fields via `extra`. The
  conductor JSON path can pass `format: "json"` or
  `extra: { format: "json" }` to nudge Gemma into strict JSON mode.
- Session SSE: `apps/runtime/src/index.ts` `GET /api/sessions/:id/events`
  — already used by the UI to drive the terminal dock and orb status
  strip. Reuse for the in-thread progress watcher.
- Existing creation handlers to reuse INTERNALLY (don't loop through
  HTTP):
  - `createWorkspace`, `createTask`, `launchHarness` /
    `launchHarnessSession` (whichever is exported by `@ward/memory` /
    `@ward/harness`). Plan execution should call these directly so
    we don't add a network hop per step.
- Glass modal + inline elements styling: task 015's `styles.css`
  block for `.glass-modal`, `.modal-tab-button`, `.agent-card`. The
  inline confirmation row should pick up the same border / blur / dark
  surface tokens.
- Workspace dropdown + Cmd+L shortcut from 015 — keep both intact.
  Cmd+L still launches the existing modal; the conductor is an
  additional path, not a replacement.

## Implementation Steps

1. Define `OrbPlan` / `OrbStep` schemas in
   `packages/core/src/orb/index.ts` and re-export from
   `packages/core/src/index.ts`.
2. Build `composeOrbConductorPrompt()` in the runtime with the action
   vocabulary, 2–3 worked examples, and the strict-JSON contract.
3. Wire `POST /api/orb/chat/stream` to switch on `mode`. Implement the
   `auto` classifier as a one-token Ollama call (cheap).
4. Implement plan parsing + Zod validation + corrective retry. On
   success, emit `plan_proposed` and let the client confirm.
5. Add `POST /api/orb/conductor/execute` SSE handler. Resolve `$N.field`
   bindings. Execute steps through internal function calls (not HTTP).
   Emit `step_started` / `step_completed` / `chain_completed` /
   `chain_canceled` / `error` events.
6. UI: extend the existing orb-stream consumer to handle the new
   event types. Render the inline confirmation row, the step
   progress markers, and the session watcher.
7. Manual smoke: end-to-end "add a task X to brief and launch Claude
   on it" produces task + session + watcher; cancel before
   confirmation; failed step reports cleanly.
8. Update Implementation Notes; move 016 to Testing in TASKS.md.

## Acceptance Criteria

1. Typing `Add a task "Add a /health endpoint" to project brief and
   assign to Claude Code` in the orb produces a plan with two steps
   (create_task + launch_session) and renders an inline confirmation
   row in the transcript.
2. Pressing **Run plan** creates the task, launches a Claude session,
   and renders step-by-step markers in the same transcript turn.
3. Pressing **Cancel** ends the chain with no state changes.
4. After `launch_session`, the orb appends compact lifecycle progress
   markers from the session's SSE stream until it reaches a terminal
   state.
5. Asking a non-actionable question ("how am I doing?") in `auto`
   mode replies as plain chat — no plan, no confirmation row.
6. A request that references a non-existent workspace
   (`Add a task to project does-not-exist`) is rejected with a clear
   transcript line and no state changes.
7. A model output that isn't valid JSON triggers one corrective retry,
   then falls back to plain chat mode for that turn.
8. The conductor prompt is NOT user-configurable in this task (it's
   loaded from the runtime). Task 017 settings continue to control
   the chat-mode prompt independently.
9. Cmd+Enter confirms an inline plan; Esc cancels it.
10. `bun run typecheck`, `bun run build`, `git diff --check`, and
    dependency-cruise pass.

## Verification

- `bun run typecheck`
- `bun run build`
- `git diff --check`
- Direct curl smoke against `/api/orb/chat/stream` with
  `mode: "conductor"` for the example phrase, then
  `/api/orb/conductor/execute` with the returned plan; verify SSE
  framing.
- Manual UI smoke against a running daemon:
  - Empty workspace, then `Add a task "Add /health endpoint" to brief
    and assign to Claude Code` → confirm + run → see task + session
    appear without leaving the home view.
  - `What should I work on?` → plain chat reply.
  - Reference a fake workspace → friendly rejection.

## Implementation Notes

### What Changed

- `packages/core/src/orb/index.ts` defines the typed `OrbPlan` schema:
  a discriminated union of `OrbStep` kinds (`create_task`,
  `launch_session`, `read_overview`, `read_session`,
  `read_workspace`) with strict per-kind args and
  `$N.field` step references constrained by regex. `OrbPlanSchema` and
  `planRequiresConfirmation()` are re-exported from `@ward/core` so the
  runtime, future tests, and any client share one source of truth.
- The runtime's `POST /api/orb/chat/stream` now accepts an optional
  `mode: "auto" | "chat" | "conductor"` body field. The default is
  `auto`: if the user's message contains an action verb, a one-token
  `classifyOrbIntent()` Ollama call decides between `chat` and
  `conductor`. `chat` mode keeps the existing streaming reply path.
- `composeOrbConductorPrompt()` is built fresh per request from the
  live workspace, brain, and open-task lists (no hallucinated slugs,
  brain ids, or task ids), embeds three worked few-shot examples,
  and forces JSON-only output. The conductor path uses non-streaming
  `ollamaChat` with `extra: { format: "json" }`, low temperature,
  and a single corrective retry. On the second failure it falls
  back to plain chat for that turn (`planner_fallback: true` in the
  `done` frame).
- A successful plan is validated server-side against existing
  workspace slugs and brain ids; any reference miss surfaces as a
  friendly `delta` text without state changes. Valid plans force
  `needs_confirmation: true` whenever a `launch_session` step is
  present and emit a `plan_proposed` SSE frame carrying the canonical
  plan and a human-readable summary.
- `POST /api/orb/conductor/execute` re-validates the plan, then
  executes steps in order through internal calls (no HTTP loop):
  `createTask` for tasks, the existing `launchHarnessSession`
  (`prepareHarnessLaunch` + `drainHarnessQueue`) for sessions,
  `getOverview`, `getHarnessSessionDetail`, `getWorkspaceDetail` for
  reads. `$N.field` references are resolved against prior step
  results before the step runs. The handler emits `step_started` /
  `step_completed` / `error` / `chain_completed` / `done` SSE frames.
  A failure stops the chain cleanly; prior steps are not rolled back
  per the spec.
- The UI orb consumer recognizes the new `plan_proposed` frame, the
  `step_*` frames, and `chain_completed`. A single ward turn carries
  the proposal, accumulating step events, session watchers, and the
  final summary so the conversation stays cohesive (no extra
  bubbles). After a `launch_session` step completes, the UI attaches
  an `EventSource` to `/api/sessions/:id/events`, listens for
  `session.state_transitioned`, and renders compact lifecycle markers
  in-thread until the state reaches `done`/`failed`/`blocked`/
  `canceled`.
- The inline confirmation row uses task 015's glass tokens — Run /
  Cancel pills above the transcript bubble, plus a `⌘↵ run · esc
  cancel` hint. Cmd/Ctrl+Enter confirms the most recent awaiting
  plan and Esc cancels it; the existing palette/launch shortcuts
  still work because the awaiting-plan check runs first.

### Files Changed

- `packages/core/src/orb/index.ts` (new) — Zod schemas + helpers.
- `packages/core/src/index.ts` — re-export the orb module.
- `apps/runtime/src/index.ts` — added `composeOrbConductorPrompt`,
  `classifyOrbIntent`, `generateOrbPlan`, `validatePlanReferences`,
  `resolveStepRef`, `executeOrbStep`,
  `handleOrbConductorPlanStream`, `handleOrbConductorExecute`;
  switched `handleOrbChatStream` on `mode`; routed
  `POST /api/orb/conductor/execute`.
- `apps/ui/src/main.tsx` — extended `OrbChatTurn` with plan/step/
  watch fields; handle `plan_proposed` in the existing reader; added
  `runOrbConductorPlan`, `cancelOrbConductorPlan`, and
  `watchOrbSession` (session SSE attached after `launch_session`);
  rendered the inline confirmation row, step list, and watch
  markers; bound Cmd+Enter / Esc.
- `apps/ui/src/styles.css` — `.orb-plan*` styles for the plan
  surface (steps, watches, summary, confirmation pill row, hint).
- `TASKS.md` — moved task 16 to In Progress (later promoted to
  Testing by the workflow linter as task 17 closed out).

### Deviations From Plan

- The action vocabulary in v1 is exactly the five kinds the spec
  lists (`create_task`, `launch_session`, `read_overview`,
  `read_session`, `read_workspace`), no extras.
- The conductor system prompt is composed per request from
  `listWorkspaces()` and `getBrainRegistry()` rather than relying on
  the chat-mode context blocks. This keeps the conductor prompt
  decoupled from task 017's user-configurable chat prompt, as the
  spec requires.
- The session progress watcher reads `session.state_changed` events
  (the actual runtime event type, not the spec's
  `session.state_transitioned`) and reads the `to_state` field from
  the payload. It renders state arrows ("initializing →
  implementing") and detaches on any terminal state, on
  `EventSource` error, or implicitly when the page unmounts. There
  is no UI dismiss control in v1 — the watcher ends itself when the
  session ends, matching the spec's "watcher detaches when
  terminal" requirement.
- The orb's auto-TTS-on-reply behavior is suppressed when the
  stream emitted a `plan_proposed` frame, so the human summary
  doesn't blurt aloud before the user has decided whether to run
  the plan.
- `runOrbConductorPlan` triggers `refresh()` and the active
  workspace's session/detail refresh after the chain completes so
  newly created tasks and sessions show up in their drawers without
  the user leaving the home view.

### Post-implementation: model bump to gemma4:e4b

A pair of probe scripts under `scripts/probe-orb-classifier.ts` and
`scripts/probe-orb-planner.ts` were added to drive the actual local
brain through the same prompts the runtime uses. On the original
default (`gemma4:e2b`, 5.1B) the classifier returned an empty string
on **0 of 5 actionable prompts** while correctly answering "chat" on
conversational ones, meaning every actionable prompt silently fell
through to chat. On `gemma4:e4b` (8B) the classifier scored
**9 of 9** actionable as "conductor" and **4 of 4** chat as "chat",
with ~270 ms warm latency. Plan generation was 5/5 valid on both
models. The default `DEFAULT_OPENAI_COMPATIBLE_MODEL` was therefore
bumped from `gemma4:e2b` to `gemma4:e4b` in
`apps/runtime/src/index.ts`, the seeded `local-openai-compatible`
brain in `packages/memory/src/brains.ts`, and the Settings copy in
`apps/ui/src/main.tsx`. Existing instances with empty `model` in
the brain registry pick up the new default on the next daemon
restart; instances with an explicit model keep their override.

### Verification Run

- `bun run typecheck` — PASS
- `bun run build` — PASS (vite build, tsc, dependency-cruise,
  layer-fixture lint)
- `git diff --check` — PASS (no whitespace errors)
- Manual UI smoke — SKIPPED (requires running daemon + Ollama; will
  be exercised in the test stage).
