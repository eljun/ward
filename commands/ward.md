---
description: View or edit WARD settings without hand-editing ~/.ward/config.json. Subcommands: status, setup, voice, brain, proactive, doctor.
---

Run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/ward_config.py` with the user's subcommand and arguments.

Supported subcommands:

- `/ward status` — Print a summary of the active config (brain, voice, proactive knobs, registered projects).
- `/ward setup [--force]` — Seed `~/.ward/` on first install (idempotent). Use `--force` to overwrite existing seed files.
- `/ward voice <voice-name>` — Set the macOS voice (e.g. `Zoe`) or ElevenLabs voice id, depending on the active `tts_provider`.
- `/ward brain <provider> [model]` — Switch brain provider (`ollama`, `openai`, `anthropic`) and optionally the model.
- `/ward proactive on|off|cooldown N|chat N` — Toggle proactive commentary or tune `cooldown_seconds` / `conversation_min_chars`.
- `/ward doctor` — Verify Ollama reachability, API keys, TTS availability, and config health.

Examples:

```
/ward status
/ward voice Zoe
/ward brain anthropic claude-haiku-4-5-20251001
/ward proactive cooldown 60
/ward proactive chat 80
/ward doctor
```

If a subcommand is missing required arguments, the backing script prints a usage message. Pass the user's subcommand and arguments through verbatim. `${CLAUDE_PLUGIN_ROOT}` is expanded by Claude Code to the installed plugin directory.
