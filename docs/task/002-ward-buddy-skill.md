# Ward Buddy Skill — Talk To Ward On Demand

> **ID:** 2
> **Status:** PLANNED
> **Priority:** MEDIUM
> **Type:** feature
> **Version Impact:** minor
> **Created:** 2026-04-16
> **Platform:** CLI
> **Automation:** manual

## Overview

WARD currently only speaks when a Claude Code hook fires (SessionStart, Stop,
SessionEnd, PostToolUseFailure). Even with the buddy-mode gate loosened, there
is no way for the user to directly address Ward mid-session and get a spoken
reply back. This task adds a Claude Code skill that the main assistant invokes
when the user says one of the "magic words" (e.g. "hey ward", "ward, thoughts?",
"ward what do you think"), routing the user's ask into `brain.py` and then into
`speak.py`.

This makes Ward feel like a buddy on the call rather than a turn-review bot.

## Development Approach

**Methodology:** Standard
**Rationale:** Small surface area (one skill directory + one script entry), but
the UX needs care: skill description phrasing decides whether the main model
actually invokes it at the right time.

## Requirements

### Must Have
- [ ] Add a Claude Code skill under `.claude-plugin/skills/ward-buddy/` (or the
      correct plugin skills location for this repo) with a description that
      reliably triggers on phrases like "hey ward", "ward, ...", "ward what do
      you think", "ward thoughts", "talk to ward".
- [ ] Skill entrypoint calls a new script (e.g. `scripts/ward_ask.py`) that:
    - Accepts the user's message as input.
    - Loads the current project state via `state_store.py`.
    - Calls `brain.run(event="ward_ask", context=..., mode="speak")`.
    - Pipes the result into `speak.speak(...)`.
- [ ] Add a matching `ward_ask` block in `persona.txt` so Gemma knows how to
      respond as Ward (conversational, 1–2 sentences, peer-dev tone, may banter).
- [ ] Skill must not edit files or run tools — it is a read-only buddy channel.
- [ ] Works without any cloud API keys when Gemma is the configured brain.

### Nice to Have
- [ ] Support a trailing `--topic` hint from the skill invocation so Ward can
      bias the reply (e.g. "stuck", "decision", "rubber-duck").
- [ ] Feed the last few user/assistant turns from the transcript into the
      context so Ward's reply feels aware of the current thread.
- [ ] Track a `last_ward_ask_at` timestamp in state to feed back into the
      proactive cooldown (so Ward doesn't immediately re-chime after a direct
      ask).

## Current State

- `post_response.py` now passes a `conversation_turn` signal so pure chat turns
  reach the brain, but that path is still reactive — Ward decides on his own
  whether to speak, and the user cannot directly prompt him.
- `scripts/summary_request.py` already shows the pattern of a user-initiated
  Ward speech path (command → brain → speak) and should be the template.
- Claude Code plugin skills are defined under the plugin, not under the user's
  project. The exact layout inside `.claude-plugin/` needs to be confirmed
  against current Claude Code plugin docs before implementation.

## Proposed Solution

1. Add a skill manifest that tells the main Claude model: "When the user is
   addressing someone named Ward, or saying 'hey ward' / 'ward, ...' / 'talk
   to ward', invoke this skill with their message."
2. The skill entrypoint invokes `scripts/ward_ask.py "<user message>"`.
3. `ward_ask.py`:
   - Resolves project + state like the other hooks/commands.
   - Builds a context dict with `user_message`, `project`, `current_task`,
     `top_priorities`, `recent_ward_lines`, and (optionally) a slim transcript
     tail.
   - Calls `brain.run(event="ward_ask", context=context, mode="speak")`.
   - Updates `recent_ward_lines` and `last_spoken_at` in state to keep the
     anti-repeat / cooldown logic consistent with the proactive path.
   - Calls `speak.speak(reply)`.
4. Extend `persona.txt` with a `ward_ask` section:
   - Respond as a peer dev the user just pinged on a call.
   - 1–2 sentences, casual, direct.
   - Banter allowed when the ask is off-topic.
   - Never re-explain what's already in chat.

### File Changes

| Action | File | Description |
|--------|------|-------------|
| CREATE | `.claude-plugin/skills/ward-buddy/SKILL.md` (path tbd) | Skill manifest + trigger description |
| CREATE | `scripts/ward_ask.py` | Entrypoint script invoked by the skill |
| MODIFY | `persona.txt` | Add `ward_ask` event guidance |
| MODIFY | `scripts/bootstrap.py` | Install skill alongside commands if needed |
| MODIFY | `README.md` | Document the "hey ward" usage pattern |
| MODIFY | `CHANGELOG.md` | Note the new skill under the next minor version |

## Implementation Steps

### Step 1: Confirm Plugin Skill Layout

Before writing code, confirm where Claude Code plugins load skills from today
(plugin skills vs. user skills vs. project skills). Pick the path that makes
the skill available in any project where the ward plugin is installed, to match
WARD's global-install model.

### Step 2: Add `scripts/ward_ask.py`

Mirror `scripts/summary_request.py`:
- Load config + state.
- Build context.
- Call `brain.run(event="ward_ask", ...)`.
- Speak the reply.
- Update `recent_ward_lines` and `last_spoken_at`.

Read stdin or argv for the user's message so the skill can pass it through
cleanly.

### Step 3: Write The Skill Manifest

Focus on the description. Phrases the main assistant should match on:
- "hey ward"
- "ward, thoughts?" / "ward what do you think"
- "talk to ward" / "ping ward"
- Direct address where "Ward" is clearly the subject.

The description must make it clear the skill does NOT edit code or run tools —
it only speaks back as Ward.

### Step 4: Persona Update

Add a `ward_ask` block to `persona.txt`. Keep the same voice as the loosened
`post_response` block. Emphasize:
- Respond to the message directly.
- 1–2 sentences.
- Off-topic banter allowed when the ask isn't about code.
- Do not repeat recent Ward lines.

### Step 5: Docs + Bootstrap

- Document usage in `README.md` under a new "Talk to Ward" section.
- If the skill needs to be copied to `~/.claude/` (or equivalent) on install,
  extend `bootstrap.py` the same way it currently installs slash commands.

## Acceptance Criteria

### Happy path
- [ ] Given a running Claude Code session with the ward plugin installed, when
      the user types "hey ward, what do you think about this approach?", then
      the main assistant invokes the ward-buddy skill and Ward speaks a 1–2
      sentence reply via the configured TTS provider.
- [ ] Given Gemma is the configured brain, when the skill runs, then no cloud
      API key is required and the full round-trip works locally.
- [ ] Given the user has spoken to Ward, when the next proactive turn fires,
      then Ward does not immediately repeat himself (state + cooldown respected).

### Error states
- [ ] Given Ollama is not running, when the skill is invoked, then Ward fails
      toward silence and prints a non-crashing reason to stderr.
- [ ] Given the user message is empty, when the skill is invoked, then nothing
      is spoken and no state is updated.

### Edge cases
- [ ] Off-topic asks ("ward, I'm bored") still produce a short buddy reply.
- [ ] Rapid-fire asks respect `cooldown_seconds` so Ward does not stack replies.
- [ ] The skill never triggers on incidental mentions of the word "ward" that
      are clearly not addressing the buddy (e.g. discussing this repo's name in
      a PR description).

## Dependencies

- Required packages: None new (reuses `brain.py`, `speak.py`, `state_store.py`).
- Required APIs: None when Gemma is the brain; optional OpenAI/Anthropic keys
  remain supported via existing `brain.py` routing.
- Blocked by: Confirming the current Claude Code plugin skill layout.

## Notes for Implementation Agent

- Reuse `scripts/summary_request.py` as the structural template.
- Do NOT introduce a second TTS path. `speak.speak()` is the only output
  channel.
- Keep Ward read-only. The skill must never gain edit/tool permissions.
- The skill's description string is the primary UX. Iterate on it until the
  main assistant invokes it reliably on "hey ward" phrasing without over-
  triggering on passing mentions.

## Related

- Companion change: buddy-mode gate loosening in `hooks/post_response.py` and
  conversational tone update in `persona.txt`.
- Sibling task: [001-codex-session-subscription-adapter.md](001-codex-session-subscription-adapter.md)
