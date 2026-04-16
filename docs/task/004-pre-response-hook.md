# Pre-Response Hook — Ward Acknowledges Before Claude Replies

> **ID:** 4
> **Status:** PLANNED
> **Priority:** HIGH
> **Type:** feature
> **Version Impact:** minor
> **Created:** 2026-04-16
> **Platform:** CLI
> **Automation:** automatic

## Overview

Ward only observes *completed* turns today — `Stop` fires after Claude's whole
response is done, so during a multi-minute turn (thinking + tool loops + long
reply) Ward is silent the entire time. For a live coding buddy that gap is the
worst place to be mute.

Claude Code exposes a `UserPromptSubmit` hook that fires the moment the user
hits enter, before the assistant starts generating. This task wires that hook
into WARD so Ward can deliver a short, state-aware acknowledgment ("on it,"
"that's a big one," "sure, while you were away Claude finished the migration")
in the gap before Claude's reply lands.

The win is two-fold:
1. Ward fills dead air during long Claude turns so the session feels alive.
2. Because Ward already carries recent Stop-state, the acknowledgment can be
   *tailored* (current task, last thing Ward said, pending PR, active file),
   not a canned "working on it."

## Development Approach

**Methodology:** Standard
**Rationale:** One new hook entrypoint, one new brain mode, one new persona
block. The interesting engineering is latency and the double-speak guard —
Ward must not acknowledge at prompt-submit *and* comment again at `Stop` on the
same turn without a reason.

## Requirements

### Must Have
- [ ] Declare `UserPromptSubmit` in `.claude-plugin/plugin.json`, pointing to a
      new `hooks/pre_response.py`.
- [ ] `pre_response.py` reads the user prompt from hook stdin (the same
      transcript-input contract the existing hooks use), loads per-project
      state, and calls `brain.run(event="pre_response", mode="decision"+"speak")`.
- [ ] Decision path must be fast enough that the spoken ack doesn't collide
      with Claude's real reply. Target: brain call + TTS kicked off inside ~1s
      on local Gemma. Enforce a hard timeout; on miss, fail silent.
- [ ] Context fed to Gemma must include: `user_prompt`, `current_task`,
      `top_priorities`, `recent_ward_lines`, `last_turn_summary`,
      `last_spoken_at`. This is what makes the reply tailored rather than
      canned.
- [ ] New persona block `pre_response` in `persona.txt`: 1 short sentence,
      peer-dev tone, acknowledge without predicting the answer.
- [ ] State write: stamp `last_pre_response_at` and append to
      `recent_ward_lines` so the following `post_response` can avoid repeating.
- [ ] Double-speak guard: if `post_response` runs within N seconds of a
      `pre_response` on the same turn, it must either skip or explicitly
      build on what was just said (carry the pre-response line into context).
- [ ] Respect `proactive.enabled`. When proactive is off, pre_response is off.

### Nice to Have
- [ ] Prompt-type heuristics before hitting the brain: one-word prompts, pure
      questions, `/slashcommand` invocations, and very short asks can be
      auto-silenced locally to avoid chatter.
- [ ] Config knob `proactive.pre_response.enabled` so users can disable just
      the pre-response path while keeping post-response proactive on.
- [ ] Config knob `proactive.pre_response.min_prompt_chars` so "y" / "ok" /
      "continue" never trigger an ack.
- [ ] Streaming ack: if the user prompt looks long-form (explicit planning
      ask, architecture question), let Ward say something slightly longer
      like a one-line restatement.

## Current State

- Hooks that exist: `SessionStart`, `Stop` (as `post_response.py`),
  `PostToolUse` (errors only), `SessionEnd`.
- No hook fires in the window between user-submit and first Claude token.
- `brain.py` already supports event+mode routing and per-mode model overrides
  via `brain_models["pre_response:decision"]`, so the brain side extends
  cleanly.
- `state_store.py` already tracks `recent_ward_lines`, `last_spoken_at`,
  `last_turn_summary`. Only `last_pre_response_at` is new.

## Proposed Solution

### Flow

1. User hits enter. Claude Code fires `UserPromptSubmit` with the submitted
   prompt in the hook input.
2. `hooks/pre_response.py` runs:
   - `ensure_ward_home_silent()`.
   - Cheap local gate: proactive disabled? prompt under
     `pre_response.min_prompt_chars`? `last_pre_response_at` inside
     `cooldown_seconds`? → exit silent.
   - Load state via `state_store.py`.
   - Build context (prompt + recent state + last turn).
   - `brain.run(event="pre_response", mode="decision", ...)` → speak / silent.
   - If speak: `brain.run(event="pre_response", mode="speak", ...)` → line.
   - `speak.speak(line)`; write `last_pre_response_at` and append to
     `recent_ward_lines`.
3. Claude generates and eventually finishes → `Stop` fires →
   `post_response.py` sees `last_pre_response_at` and either stays quiet
   (short turn) or builds on the pre-response (long turn, meaningful result).

### File Changes

| Action | File | Description |
|--------|------|-------------|
| CREATE | `hooks/pre_response.py` | UserPromptSubmit entrypoint |
| MODIFY | `.claude-plugin/plugin.json` | Declare the new hook |
| MODIFY | `persona.txt` | Add `pre_response` persona block |
| MODIFY | `hooks/post_response.py` | Honor `last_pre_response_at` to avoid doubling up |
| MODIFY | `scripts/state_store.py` | Add `last_pre_response_at` getter/setter |
| MODIFY | `scripts/ward_config.py` | `/ward proactive pre on|off` toggle |
| MODIFY | `README.md` | Document the new hook + config knobs |
| MODIFY | `WARD_SPEC.md` | Add pre_response to the hook surface |
| MODIFY | `CHANGELOG.md` | New minor-version entry |

## Implementation Steps

### Step 1: Confirm hook input contract

Check what Claude Code passes into `UserPromptSubmit` (the prompt text,
transcript path, session id). Match whatever shape the other hooks already
consume — the stdin JSON pattern in `session_start.py` / `post_response.py`
is the reference.

### Step 2: Skeleton hook with local-only gate

Ship a first version that only does the cheap checks (enabled, min chars,
cooldown) and writes a debug line to state — no brain call yet. Verify it
actually fires on prompt submit in a live session.

### Step 3: Wire the brain path

Add `pre_response` handling in `brain.py` routing and the persona block.
Enforce a hard timeout on the brain call (start with 1.5s, tune from there).
On timeout → silent, do not block the session.

### Step 4: Double-speak guard in post_response

In `hooks/post_response.py`, read `last_pre_response_at`. If it's inside
`cooldown_seconds`:
- Short/routine turn → stay silent (the ack was enough).
- Long/meaningful turn → pass the pre-response line into `recent_ward_lines`
  so Gemma naturally avoids repeating it.

### Step 5: Config + docs

Add `proactive.pre_response` section to the seed config. Extend `/ward
proactive` subcommand in `scripts/ward_config.py`. Update README under "Tune
Proactive Behavior" and the usage table. Spec + changelog.

## Acceptance Criteria

### Happy path
- [ ] Given a live Claude Code session, when the user submits a substantive
      prompt, then within ~1s Ward speaks a single tailored acknowledgment
      referencing current task / recent context, and Claude's reply is
      unaffected.
- [ ] Given Ward pre-acknowledged a short turn, when `Stop` fires seconds
      later, then Ward stays silent (no double-speak).
- [ ] Given Ward pre-acknowledged a long turn (multi-minute, real work
      done), when `Stop` fires, then Ward may speak again but explicitly
      builds on the earlier ack rather than repeating it.

### Error states
- [ ] Given Ollama is unreachable, when the hook fires, then the brain call
      times out, Ward stays silent, and the session continues normally.
- [ ] Given `proactive.enabled` is false, when the hook fires, then the
      script exits immediately without a brain call.

### Edge cases
- [ ] Given the user submits a one-word prompt ("yes", "continue"), when the
      hook fires, then Ward stays silent.
- [ ] Given the user submits a slash command (`/recap`), when the hook
      fires, then Ward stays silent (slash commands have their own voice
      path).
- [ ] Given two prompts are submitted within `cooldown_seconds`, when the
      second hook fires, then Ward stays silent on the second one.

## Dependencies

- Required packages: None new.
- Required APIs: None when Gemma is the brain.
- Blocked by: Nothing — `UserPromptSubmit` is an existing Claude Code hook.

## Notes for Implementation Agent

- The whole point of this hook is speed. If it feels slow in practice, shrink
  the context before adding more config knobs. A tailored-but-late ack is
  worse than a fast generic one.
- Do not add a second TTS path. `speak.speak()` stays the only output
  channel.
- The double-speak guard is the easiest thing to get wrong. Test the
  short-turn path explicitly — Ward must not say "on it" and then
  immediately say "done" two seconds later.
- The persona block should forbid predicting the answer. Ward is
  acknowledging the question, not answering it; Claude answers it.

## Related

- Depends on: [003-plugin-native-install-refactor.md](003-plugin-native-install-refactor.md) (plugin hook manifest must exist, which it now does).
- Sibling: [002-ward-buddy-skill.md](002-ward-buddy-skill.md) — user-initiated speech path; this task is the automatic pre-reply path.
