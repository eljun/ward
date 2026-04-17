# Provider-Agnostic Session Runtime And Adapter Layer

> **ID:** 1
> **Status:** PLANNED
> **Priority:** HIGH
> **Type:** architecture
> **Version Impact:** minor
> **Created:** 2026-04-15
> **Updated:** 2026-04-17
> **Platform:** CLI
> **Automation:** manual

## Overview

WARD currently has two separate architectural ideas competing with each other:

1. The shipped path is still **Claude-hook-centric**. Hook scripts like
   `session_start.py`, `post_response.py`, and `session_end.py` read raw Claude
   payloads directly, build their own context, call the brain, and write state.
2. A newer Codex draft already exists in the working tree with a normalized
   event model, a Codex adapter, and a shared turn runtime.

That split is the real problem. Codex support should not be bolted onto the
side of a Claude-specific runtime, and Claude hooks should not keep owning
their own logic once a shared runtime exists.

This task reframes the old "Codex session subscription adapter" idea into the
larger architectural seam WARD actually needs:

- **Session-source-agnostic ingestion**
- **Shared runtime/state handling**
- **Model-provider-agnostic brain calls**
- **Read-only output behavior**

In practical terms: Claude hooks, Codex app-server, and Codex `exec --json`
should all feed a common internal event model and runtime. `brain.py` should
stay responsible only for model/provider routing such as Ollama, OpenAI, and
Anthropic.

## Development Approach

**Methodology:** Standard
**Rationale:** This is now an architectural consolidation task, not just a
single Codex integration. The key deliverable is a clean boundary between
session ingestion, runtime logic, and brain provider routing.

## Requirements

### Must Have
- [ ] Define a provider-agnostic session event schema for live and hook-based
      coding sessions.
- [ ] Introduce a shared runtime that owns turn accumulation, proactive gating,
      state updates, and brain invocation.
- [ ] Add a Codex adapter that can ingest live session events without relying
      on Claude hooks.
- [ ] Add a Claude hook adapter layer so Claude events also use the shared
      runtime instead of embedding logic in hook scripts.
- [ ] Keep `brain.py` model-provider-agnostic only. It must route between
      Ollama, OpenAI, and Anthropic, but it must not parse Claude or Codex
      payloads directly.
- [ ] Preserve WARD as a read-only observer with no code-editing or
      tool-execution responsibilities.
- [ ] Reuse existing state selection, gating, and interpretation flows where
      possible instead of duplicating them in multiple entrypoints.
- [ ] Document the new architecture, including the difference between
      `session_source` and `brain_provider`.

### Nice to Have
- [ ] Leave a clean adapter interface for future session sources beyond Claude
      and Codex.
- [ ] Support more than one Codex ingestion source if the primary path is
      unavailable.
- [ ] Make `Task 004` pre-response support a thin adapter/runtime extension
      instead of another hook-specific implementation.

## Current State

The repo currently reflects two different layers of abstraction:

### Shipped path

Claude hook scripts still contain source-specific runtime logic:
- `hooks/session_start.py`
- `hooks/post_tool_use.py`
- `hooks/post_response.py`
- `hooks/session_end.py`

Notably, `hooks/post_response.py` still owns:
- transcript parsing
- turn extraction
- proactive gating
- decision parsing
- state updates
- output emission

That means the main runtime is still effectively Claude-specific.

### Draft path already in the working tree

There is already a partial architecture seam for Codex:
- `scripts/session_events.py`
- `scripts/codex_adapter.py`
- `scripts/turn_runtime.py`
- `scripts/ward_codex_observe.py`
- `scripts/test_codex_observer.sh`

Those files point in the right direction, but they are not yet the primary
runtime path, and Claude hooks do not currently use the same abstractions.

### Why the old framing is too narrow

The original Task 001 framing focused on Codex support. That is still
important, but the deeper issue is that WARD needs a **session-source-agnostic
runtime**, not a second one-off integration path.

The architectural distinction should be:

- **Session source / transport**
  Claude hooks, Codex app-server, Codex `exec --json`
- **Brain provider**
  Ollama, OpenAI, Anthropic

Those are different seams and should stay separate.

## Proposed Solution

Introduce a shared session runtime with source-specific adapters.

### Design Principle

WARD should process normalized internal events, not raw Claude or Codex
payloads.

### Boundary Split

#### Session adapters

Responsible for:
- reading source-specific payloads
- normalizing them into internal `SessionEvent`s
- preserving raw payloads only for debugging

Examples:
- Claude hooks adapter
- Codex app-server adapter
- Codex `exec --json` adapter

#### Runtime

Responsible for:
- session and turn accumulation
- turn signature generation
- proactive gating
- state loading and writing
- summary-offer tracking
- building normalized context for the brain
- enforcing read-only behavior

#### Brain

Responsible for:
- loading persona
- choosing `brain_provider` and model
- calling Ollama / OpenAI / Anthropic
- returning `speak`, `decision`, `summary`, or `state` outputs

`brain.py` should not know whether the request came from Claude hooks or Codex.

#### Outputs

Responsible for:
- spoken text
- printed text
- silence

Outputs remain separate from ingestion.

### Architecture

- `scripts/session_events.py`
  Canonical event schema and helpers
- `scripts/claude_adapter.py` or `scripts/adapters/claude_hooks.py`
  Claude hook payload normalization
- `scripts/codex_adapter.py`
  Codex app-server and exec event normalization
- `scripts/session_runtime.py`
  Session/turn accumulation and event handling
- `scripts/turn_runtime.py`
  Shared decision/state path for completed turns or prompt-submit turns
- `scripts/ward_codex_observe.py`
  Observer loop for Codex streams
- `hooks/*.py`
  Thin entrypoints that translate hook payloads into normalized events and pass
  them into the shared runtime

Initial target:
- Claude remains supported
- Codex becomes supported through the same runtime seam
- `Task 004` builds on this architecture instead of adding more duplicated hook
  logic

## File Changes

| Action | File | Description |
|--------|------|-------------|
| MODIFY | `docs/task/001-codex-session-subscription-adapter.md` | Update task scope from Codex-only to provider-agnostic runtime architecture |
| MODIFY | `README.md` | Future update to explain Claude + Codex support and the architecture split |
| MODIFY | `WARD_SPEC.md` | Future update to separate session sources from brain providers |
| CREATE or MODIFY | `scripts/session_events.py` | Canonical normalized event schema |
| CREATE | `scripts/claude_adapter.py` or `scripts/adapters/claude_hooks.py` | Claude hook payload normalization |
| MODIFY | `scripts/codex_adapter.py` | Codex normalization kept as an adapter, not a runtime owner |
| CREATE | `scripts/session_runtime.py` | Shared event-driven runtime for session/turn accumulation |
| MODIFY | `scripts/turn_runtime.py` | Shared decision/state processing for normalized turns |
| MODIFY | `hooks/session_start.py` | Convert to thin adapter entrypoint |
| MODIFY | `hooks/post_tool_use.py` | Convert to thin adapter entrypoint |
| MODIFY | `hooks/post_response.py` | Remove embedded runtime ownership and call shared runtime |
| MODIFY | `hooks/session_end.py` | Convert to thin adapter entrypoint |
| FUTURE MODIFY | `hooks/pre_response.py` | `Task 004` should land on top of this runtime seam |

## Code Context

### Existing state selection already reusable

From `scripts/state_store.py`, project resolution is already centralized and
should remain that way:

```python
def find_project_config(cwd: str, config: dict) -> tuple[str, dict]:
    projects = config.get("projects", {}) or {}
    if not projects:
        return "", {}
```

Adapters should emit `cwd`; runtime/state selection should stay centralized.

### Existing runtime duplication to remove

`hooks/post_response.py` still embeds its own gate and state flow, while
`scripts/turn_runtime.py` contains a second version of similar logic. That
duplication is the immediate signal that the seam is not finished yet.

### Existing Codex draft to preserve

The current draft already proves the basic direction:
- normalized session events
- Codex event normalization
- observer loop
- shared turn processing

This task should build on that work rather than replacing it.

## Implementation Steps

### Step 1: Finalize The Internal Session Schema

Define a small, explicit event model for:
- `session_started`
- `session_resumed`
- `session_ended`
- `turn_started`
- `turn_completed`
- `user_message`
- `assistant_message_delta`
- `assistant_message_completed`
- `tool_call`
- `tool_result`
- `prompt_submitted` if needed for pre-response support

Each event should carry normalized fields such as:
- `provider`
- `source`
- `session_id`
- `thread_id`
- `turn_id`
- `message_id`
- `cwd`
- `project_name`
- `timestamp`
- `tool_name`
- `content`
- `raw_event`

Keep the schema minimal and stable.

### Step 2: Make The Runtime The Single Owner

Move shared logic out of Claude-specific hook scripts into runtime modules.

Expected shared areas:
- turn accumulation
- turn signature generation
- proactive gating
- state loading/writing
- recent Ward line tracking
- summary-offer tracking
- brain decision invocation

After this step, hooks should stop owning business logic.

### Step 3: Add A Claude Adapter Layer

Create a Claude hook adapter that maps hook payloads into normalized runtime
events.

Map at least:
- `SessionStart`
- `UserPromptSubmit` for future `Task 004`
- `Stop`
- `PostToolUse`
- `SessionEnd`

This prevents `Task 004` from becoming a new hook-specific branch.

### Step 4: Finish The Codex Adapter Layer

Use the current draft as the starting point.

Preferred order:
1. Codex app-server
2. Codex `exec --json` fallback

The first implementation should prove that WARD can observe:
- user prompts
- assistant output
- turn completion
- tool activity when available

### Step 5: Clarify The Brain Boundary

Keep `brain.py` focused on model-provider routing only.

It may switch by:
- `brain_provider`
- `brain_model`
- `brain_providers[event|mode]`
- `brain_models[event|mode]`

But it should receive only normalized context and never parse raw session
payloads from Claude or Codex.

### Step 6: Land Task 004 On Top Of The Runtime

`Task 004` should be reinterpreted as:
- Claude `UserPromptSubmit` becomes another normalized event source
- pre-response acknowledgment uses the same state/runtime context as other
  paths
- double-speak guard becomes shared runtime policy, not hook-local behavior

### Step 7: Document The Architecture

Update the docs to explain:
- what `session_source` means
- what `brain_provider` means
- which Claude events are supported
- which Codex ingestion paths are supported
- whether WARD launches Codex or attaches to an existing stream
- what remains source-specific vs. shared

## Acceptance Criteria

### Happy path
- [ ] Given a Claude hook payload, when the hook fires, then the hook script
      acts as a thin adapter and the shared runtime handles the core logic.
- [ ] Given a Codex-backed session source, when a user sends a prompt and Codex
      answers, then WARD receives normalized events for the user turn and
      assistant turn without relying on Claude hooks.
- [ ] Given normalized session events from either Claude or Codex, when the
      runtime processes them, then state selection, gating, and brain calls run
      without direct dependence on source-specific payload shapes.
- [ ] Given a nested project `cwd`, when either Claude or Codex events are
      processed, then WARD resolves the correct per-project state file rather
      than falling back to the global state file.
- [ ] Given different configured brain providers, when the runtime calls the
      brain, then Ollama/OpenAI/Anthropic routing works without any Claude- or
      Codex-specific code in `brain.py`.

### Error states
- [ ] Given the Codex session source is unavailable, when the adapter starts,
      then WARD fails toward silence and logs a clear non-crashing reason.
- [ ] Given a Claude or Codex source emits an event WARD does not yet
      understand, when the adapter normalizes it, then the event is ignored or
      preserved as raw debug context without crashing the runtime.
- [ ] Given the configured brain provider is unavailable, when runtime attempts
      a call, then the failure is isolated to the brain path and does not crash
      the session adapter.

### Edge cases
- [ ] WARD does not speak twice for the same completed turn when Codex emits
      deltas before the final message completion event.
- [ ] WARD does not diverge between Claude and Codex for equivalent turn data
      just because the payload transport differed.
- [ ] WARD remains read-only even if Claude or Codex exposes command or tool
      events in the same stream.
- [ ] The runtime can distinguish session-level events from turn-level events
      and does not confuse resume/fork/thread changes with user prompts.
- [ ] `Task 004` pre-response behavior can be added through the shared runtime
      without reintroducing hook-specific state duplication.

### Test setup
- **URL:** N/A
- **Test credentials:** N/A
- **Setup required:** Local Claude Code hooks, local Codex environment, and a
  reproducible Codex event source from official Codex interfaces

## Dependencies

- Required packages: None decided yet
- Required APIs:
  - Claude Code hooks
  - Codex app-server and/or `codex exec --json`
- Blocked by: Finalizing the shared runtime seam so Claude and Codex do not
  maintain separate logic trees

## Notes for Implementation Agent

- Do not expand `brain.py` into a Claude/Codex router. That would mix two
  different abstractions.
- Treat `session_source` and `brain_provider` as separate terms in code and
  docs.
- Do not keep two copies of proactive gating logic. The runtime must become the
  single source of truth.
- Build on the existing Codex draft files rather than rewriting them from
  scratch.
- Convert hook scripts into thin adapter entrypoints incrementally, but keep
  behavior stable while migrating.
- When `Task 004` is implemented, land it on top of this runtime seam rather
  than adding more direct hook logic to `pre_response.py`.

## Related

- Sibling task: [002-ward-buddy-skill.md](002-ward-buddy-skill.md)
- Foundation task already shipped: [003-plugin-native-install-refactor.md](003-plugin-native-install-refactor.md)
- Dependent follow-up: [004-pre-response-hook.md](004-pre-response-hook.md)
- Spec: [WARD_SPEC.md](/Users/eleazarjunsan/Code/Personal/ward/WARD_SPEC.md)
- Setup and positioning: [README.md](/Users/eleazarjunsan/Code/Personal/ward/README.md)
