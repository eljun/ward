# Codex Session Subscription Adapter

> **ID:** 1
> **Status:** PLANNED
> **Priority:** HIGH
> **Type:** feature
> **Version Impact:** minor
> **Created:** 2026-04-15
> **Platform:** CLI
> **Automation:** manual

## Overview

WARD currently behaves like a Claude Code plugin with hook-driven reactions and post-turn gating. That is no longer the right core architecture for a local-first Gemma 4 sidecar, because Codex is the primary coding environment and WARD needs live, read-only visibility into the session rather than occasional hook snapshots.

This task introduces a Codex-first session subscription path so WARD can observe live user and assistant messages, normalize them into a provider-agnostic event stream, and run interpretation logic continuously without owning tools or editing code.

## Development Approach

**Methodology:** Standard
**Rationale:** This is an architectural integration task with protocol design, adapter boundaries, and incremental rollout rather than isolated pure business logic.

## Requirements

### Must Have
- [ ] Define a provider-agnostic event schema for live coding sessions.
- [ ] Add a Codex-specific adapter that can ingest live session events without relying on Claude hooks.
- [ ] Preserve WARD as a read-only observer with no code-editing or tool-execution responsibilities.
- [ ] Reuse existing WARD state, gating, and interpretation flows where possible instead of duplicating logic.
- [ ] Document the chosen Codex integration path and its constraints.

### Nice to Have
- [ ] Leave a clean adapter interface for future Claude Code and other provider integrations.
- [ ] Support more than one Codex ingestion source if the primary path is unavailable.

## Current State

WARD is currently organized around Claude Code hooks:
- `hooks/session_start.py`
- `hooks/post_tool_use.py`
- `hooks/post_response.py`
- `hooks/session_end.py`

The current repo already moved beyond raw hook narration and now uses local gating plus stateful proactive decisions, but the runtime entrypoints are still hook-triggered. This works for Claude Code and fails as the primary architecture for Codex because WARD is not subscribed to the live session stream.

## Proposed Solution

Create a Codex-first adapter layer and internal session event model:

1. Introduce a normalized `SessionEvent` / `TurnEvent` schema inside WARD.
2. Add a `CodexAdapter` that reads live Codex events from an officially supported interface.
3. Route normalized events into a shared WARD runtime that owns:
   - rolling context
   - state updates
   - proactive gating
   - summarization and interpretation decisions
4. Keep output channels separate from ingestion so WARD can speak, print, or stay silent without coupling those behaviors to Codex internals.

### Architecture

- `adapters/`
  Codex-specific ingestion and mapping code
- `runtime/`
  Provider-agnostic session state machine and rolling context store
- `schemas/`
  Common event payload definitions
- `outputs/`
  TTS and future terminal/UI outputs

Initial target: Codex first. Claude Code remains on the current hook path until a later adapter migration.

### File Changes

| Action | File | Description |
|--------|------|-------------|
| CREATE | `docs/task/001-codex-session-subscription-adapter.md` | Planning doc for Codex-first architecture |
| CREATE | `TASKS.md` | Workflow tracker for planned implementation work |
| MODIFY | `README.md` | Future update to explain Codex support and architecture shift |
| MODIFY | `WARD_SPEC.md` | Future update to move from Claude plugin framing toward adapter/runtime framing |
| CREATE | `scripts/` or `src/` runtime files | Future event schema, adapter, and runtime modules once implementation starts |

## Code Context

> Embedded by /task during research so /implement starts with the relevant architecture context.

### Current Hook-Centric Runtime Shape

From [WARD_SPEC.md](/Users/eleazarjunsan/Code/Personal/ward/WARD_SPEC.md:24):

```md
The current architecture direction is stateful and turn-aware:
- Hooks are signal sources, not scripts for what Ward should say
- `post_response.py` inspects the latest user/assistant turn rather than a raw transcript tail
- Local heuristics gate routine turns before any model call
- The model returns a structured decision for proactive turns, not raw speech by default
- `state.json` stores conversational memory so Ward can avoid repetition and preserve long replies for later summarization
```

### Current Project/State Resolution

From [scripts/state_store.py](/Users/eleazarjunsan/Code/Personal/ward/scripts/state_store.py:52):

```python
def find_project_config(cwd: str, config: dict) -> tuple[str, dict]:
    projects = config.get("projects", {}) or {}
    if not projects:
        return "", {}

    cwd_real = os.path.realpath(cwd)
    best_root = ""
    best_config = {}

    for root, project_config in projects.items():
        root_real = os.path.realpath(root)
        if cwd_real == root_real or cwd_real.startswith(root_real + os.sep):
            if len(root_real) > len(best_root):
                best_root = root_real
                best_config = project_config if isinstance(project_config, dict) else {}

    return best_root, best_config
```

This should remain reusable after the Codex integration. The session adapter should emit `cwd`, while runtime/state selection should stay centralized.

### Current Proactive Turn Entry Point

From [hooks/post_response.py](/Users/eleazarjunsan/Code/Personal/ward/hooks/post_response.py:233):

```python
def gate_turn(turn: dict, state: dict, config: dict) -> dict:
    proactive = {**DEFAULT_PROACTIVE, **config.get("proactive", {})}
    if not proactive.get("enabled", True):
        return {"should_call_brain": False, "reason": "disabled", "signals": [], "config": proactive}
    if not turn:
        return {"should_call_brain": False, "reason": "no_turn", "signals": [], "config": proactive}
    if turn["signature"] == state.get("last_seen_turn_signature"):
        return {"should_call_brain": False, "reason": "duplicate_turn", "signals": [], "config": proactive}
```

The Codex adapter should feed this style of gating through a shared runtime instead of keeping it buried inside a Claude-specific hook script.

### Official Codex Integration Findings

Research findings from official docs on 2026-04-15:

```md
- Codex app-server exposes a bidirectional JSON-RPC interface over stdio or WebSocket.
- Codex models a session as thread -> turn -> item and emits live notifications such as
  `item/agentMessage/delta`, `item/completed`, and `turn/completed`.
- Codex non-interactive mode supports `codex exec --json`, which emits JSONL-style events like
  `thread.started`, `turn.started`, `turn.completed`, `item.*`, and `error`.
- Codex also documents hooks and transcript/history persistence, but app-server is the strongest
  documented path for true live subscription.
```

Primary references:
- https://developers.openai.com/codex/app-server
- https://developers.openai.com/codex/noninteractive
- https://developers.openai.com/codex/hooks
- https://developers.openai.com/codex/config-reference

## Implementation Steps

### Step 1: Define The Internal Session Schema

Create a small, explicit event model for:
- `session_started`
- `session_resumed`
- `user_message`
- `assistant_message_delta`
- `assistant_message_completed`
- `tool_call`
- `tool_result`
- `turn_completed`
- `session_ended`

Each event should carry normalized fields such as:
- `provider`
- `session_id`
- `cwd`
- `project_name`
- `timestamp`
- `message_id`
- `turn_id`
- `tool_name`
- `content`
- `raw_event`

Keep the schema minimal and stable. Preserve original provider payloads under `raw_event` for debugging only.

### Step 2: Add A Codex Adapter

Implement a Codex-specific adapter that maps official Codex events into the internal schema.

Preferred order:
1. Codex `app-server`
2. Codex `exec --json` if a simpler first milestone is needed

The first implementation should prove that WARD can observe:
- user prompts
- assistant output
- turn completion
- tool activity when available

### Step 3: Extract Shared Runtime Logic

Move session memory and proactive decision entrypoints out of Claude-only hook scripts into reusable runtime functions.

Expected reusable areas:
- state loading/writing
- turn signature generation
- proactive gating
- rolling context updates
- summary-offer tracking

Claude hook scripts should become thin event adapters around the same runtime later.

### Step 4: Introduce A Read-Only Observer Loop

Add a process that subscribes to Codex session events and forwards normalized events to the WARD runtime. This process must not expose code-editing or tool-execution permissions to Gemma/WARD.

The runtime may emit:
- spoken text
- terminal text
- silence

But it must never generate executable actions in the adapter path.

### Step 5: Document Operational Constraints

Update the docs to explain:
- what Codex capabilities WARD depends on
- whether WARD needs to launch Codex or can attach to an existing Codex session
- what limitations remain for Claude Code until a second adapter is built
- how local Gemma 4 is used in a cheap continuous-observer mode without changing the primary coding agent

## Acceptance Criteria

### Happy path
- [ ] Given a Codex-backed session source, when a user sends a prompt and Codex answers, then WARD receives normalized events for the user turn and assistant turn without relying on Claude hooks.
- [ ] Given normalized Codex turn events, when the runtime processes them, then existing state/gating logic can run without direct dependence on hook payload shapes.
- [ ] Given a nested project `cwd`, when Codex events are processed, then WARD resolves the correct per-project state file rather than falling back to the global state file.

### Error states
- [ ] Given the Codex session source is unavailable, when the adapter starts, then WARD fails toward silence and logs a clear non-crashing reason.
- [ ] Given Codex emits an event WARD does not yet understand, when the adapter normalizes it, then the event is ignored or preserved as raw debug context without crashing the runtime.

### Edge cases
- [ ] WARD does not speak twice for the same completed turn when Codex emits deltas before the final message completion event.
- [ ] WARD remains read-only even if Codex exposes command or tool events in the same stream.
- [ ] The adapter can distinguish session-level events from turn-level events and does not confuse resume/fork/thread changes with user prompts.

### Test setup
- **URL:** N/A
- **Test credentials:** N/A
- **Setup required:** Local Codex environment plus a reproducible event source from official Codex interfaces

## Dependencies

- Required packages: None decided yet
- Required APIs: Codex app-server and/or `codex exec --json`
- Blocked by: Final choice of Codex integration path for the first implementation milestone

## Notes for Implementation Agent

- Do not start by refactoring every hook script. First carve out the shared runtime seam and prove the Codex adapter works end to end.
- Keep Claude compatibility by preserving current hook entrypoints until the shared runtime is stable.
- Prefer official Codex event interfaces over transcript scraping.
- If app-server can subscribe to existing sessions cleanly, prefer that. If not, document the limitation and start with the Codex launch path WARD can control.
- Preserve the product constraint that WARD is an interpreter sidecar, not a second coding agent.

## Related

- Spec: [WARD_SPEC.md](/Users/eleazarjunsan/Code/Personal/ward/WARD_SPEC.md)
- Setup and positioning: [README.md](/Users/eleazarjunsan/Code/Personal/ward/README.md)
