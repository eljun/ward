# Changelog

All notable changes to WARD are tracked here.
Format: [version] — date — description

---

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
