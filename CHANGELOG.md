# Changelog

All notable changes to WARD are tracked here.
Format: [version] — date — description

---

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
