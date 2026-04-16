# Changelog

All notable changes to WARD are tracked here.
Format: [version] — date — description

---

## [2.0.0] — Unreleased

### Plugin-Native Install Refactor
- WARD is now distributed as a Claude Code plugin. The primary install is `/plugin marketplace add eljun/ward` followed by `/plugin install ward@ward-plugins`. No sudo, no npm, no manual `settings.json` edits.
- `.claude-plugin/plugin.json` now declares all four hooks (`SessionStart`, `Stop`, `PostToolUse`, `SessionEnd`) so Claude Code auto-registers them on install. Previous builds left hooks undeclared, which meant they never fired unless the user wired them into `settings.json` by hand.
- Added `.claude-plugin/marketplace.json` so users can install from a self-owned marketplace without any Anthropic approval step.
- Rewrote `commands/recap.md`, `commands/summary.md`, and `commands/ward-init.md` to use `${CLAUDE_PLUGIN_ROOT}` at runtime instead of the `{ward_repo}` string substitution that was applied at npm postinstall.
- Added `/ward` slash command with subcommands: `status`, `setup`, `voice`, `brain`, `proactive`, `doctor`. Users can now view and edit WARD configuration without hand-editing `~/.ward/config.json`.
- Hooks now call `ensure_ward_home_silent()` on every fire so the first-run seed of `~/.ward/` is automatic instead of piggy-backing on npm postinstall.
- `scripts/bootstrap.py` no longer copies commands into `~/.claude/commands/` on the plugin install path; the plugin system delivers commands directly from the repo.
- Moved the npm install path under `legacy/npm/` with its own README. Kept it available as a fallback for environments without `/plugin install`, with a deprecation notice and an explicit `--legacy-commands` flag to opt into the old command-copying behavior.
- Documented the new flow in `README.md` and `WARD_SPEC.md`, bumped the spec version to 2.0.0.

### Breaking Changes
- Primary install changes from `npm install -g github:eljun/ward` to the plugin path. Existing npm users should `npm uninstall -g ward-claude` before reinstalling via the plugin system to avoid double-firing hooks.

## [Unreleased — Buddy Mode]

- Loosened the `post_response` gate with a new `conversation_turn` signal so pure chat/Q&A turns can reach the brain instead of always staying silent
- Lowered the default `cooldown_seconds` from 90 to 30 and raised `max_recent_ward_lines` from 5 to 10 so Ward chimes in more often without repeating himself
- Added `conversation_min_chars` (default 60) to `proactive` config so the minimum chat-turn length is tunable
- Rewrote the `post_response` persona block to give Ward a peer-dev buddy tone on conversational turns, not just implementation ones
- Planned follow-up tracked in `docs/task/002-ward-buddy-skill.md`: a Claude Code skill so the user can directly address Ward with "hey ward"-style triggers

## [1.3.0] — 2026-04-15

### Ollama-First Defaults Release
- Switched the default WARD brain to local `ollama / gemma4:e4b`
- Updated the bootstrap seed config to use `gemma4:e4b` as the primary model
- Expanded install docs to cover Ollama setup, model pull/check, bootstrap, and project registration
- Clarified OpenAI and Anthropic as optional alternatives or targeted overrides
- Updated the technical spec to match the Ollama-first install and runtime model

## [1.2.0] — 2026-04-15

### Local + Onboarding Release
- Added `bootstrap.py` so `~/.ward` can be initialized cleanly on first install
- Added `init_project.py` and `/ward-init` for easy project registration without hand-editing global config
- Added `/summary` and `summary_request.py` for on-demand spoken summaries of saved long replies
- Added Ollama as a third brain provider with configurable `ollama_host`
- Added `ollama_think` and per-mode `ollama_think_modes` support
- Verified `gemma4:e4b` works for proactive decisions and spoken summaries
- Documented WARD clearly as global install + project-aware runtime

## [1.1.0] — 2026-04-15

### Proactive Refactor Release
- Added `post_response.py` proactive turn review on `Stop`
- Shifted WARD from hook narration toward turn-aware, stateful commentary
- Added local gating and cooldowns so routine turns stay silent
- Added conversation memory to `state.json` for recent Ward lines, last turn context, and long-response handoffs
- Added structured `decision` mode in `brain.py` for proactive speak/no-speak decisions
- Added shared `state_store.py` helpers for per-project state reads/writes
- Added provider/model configurability in `brain.py`
- Switched the default brain to `openai / gpt-5.4-nano`
- Added OpenAI dependency and updated setup docs
- Updated `WARD_SPEC.md` and `README.md` to reflect the proactive architecture

## [1.0.0] — 2026-04-15

### Initial Release — WARD (Workspace Aware Recap Daemon)
- Persona: Ward — senior peer developer voice presence
- SessionStart hook — reads state.json, speaks daily recap
- PostToolUseFailure hook — speaks on tool errors only, silent otherwise
- SessionEnd hook — summarizes session, writes state.json
- /recap command — parses tasks file active sections, updates state.json
- brain.py — Claude Haiku API caller with Ward peer persona
- speak.py — macOS say → ElevenLabs fallback chain
- persona.txt — Ward persona system prompt, user-editable with {persona_name} substitution
- config.json — per-project tasks_md_path, voice provider settings
- state.json — hot session memory (current task, priorities, pending PRs)
