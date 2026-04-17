# WARD — Workspace Aware Recap Daemon

A peer developer voice presence for Claude Code.
**Ward** greets you at session start, recaps your last session, reacts to tool failures,
and can proactively comment after a turn when there is something actually worth saying.
The goal is not narration. The goal is a quiet senior dev riding shotgun.

> WARD — **W**orkspace **A**ware **R**ecap **D**aemon

## Install

WARD is distributed as a Claude Code plugin. From inside Claude Code:

```
/plugin marketplace add eljun/ward
/plugin install ward@ward-plugins
```

No `sudo`, no `npm`, no manual `~/.claude/settings.json` edits. On first hook fire WARD seeds `~/.ward/` automatically with config, persona, and state files.

To force the seed ahead of the first hook, run `/ward setup` once.

WARD is:
- installed at user scope via the Claude Code plugin system
- globally configured under `~/.ward`
- project-aware at runtime through the `projects` map in `~/.ward/config.json`
- Ollama-first by default, using local `gemma4:e4b`

A legacy npm install path is preserved under [`legacy/npm/`](legacy/npm/README.md) for environments where `/plugin install` is unavailable.

## Codex Usage

The plugin manifest in `.claude-plugin/plugin.json` is for Claude Code only. Codex does not currently auto-load WARD through that manifest, so the Codex path is an observer that reads Codex JSON events and routes them through the same shared WARD runtime.

For one-off Codex runs, pipe `codex exec --json` into the observer:

```bash
codex exec --json --sandbox read-only -C /absolute/path/to/project "Your prompt here" \
  | env WARD_HOME=/tmp/ward-codex-test python3 /path/to/ward/scripts/ward_codex_observe.py \
      --source exec-json \
      --output print \
      --cwd /absolute/path/to/project
```

Notes:
- `WARD_HOME=/tmp/ward-codex-test` is optional but useful for isolated testing without touching your main `~/.ward` state.
- Add `--dump-events` only when debugging. It prints every normalized event and gets noisy quickly.
- The Node wrapper [`scripts/ward-codex-observe.js`](scripts/ward-codex-observe.js) is equivalent if you prefer launching the Python observer through Node.

There is not yet a native Codex auto-hook install flow in this repository. Today, “activating WARD for Codex” means running Codex through this observer pipeline.

## Primary Brain

WARD now defaults to:
- `brain_provider: "ollama"`
- `brain_model: "gemma4:e4b"`
- `ollama_think: false`

That keeps the common proactive path local, fast, and free to run. OpenAI and Anthropic are still supported, but they are now optional overrides rather than the default install path.

## Setup

### 1. Install Ollama And The Primary Model

Install and launch Ollama on your machine, then make sure the daemon is available:

```bash
ollama list
```

If `gemma4:e4b` is not present yet, pull it:

```bash
ollama pull gemma4:e4b
```

WARD expects Ollama on the default local endpoint:

```text
http://127.0.0.1:11434
```

### 2. Bootstrap WARD Home

WARD seeds `~/.ward/` automatically the first time any hook fires. To force it up front, run from inside Claude Code:

```
/ward setup
```

Or from a shell, directly against the installed plugin:

```bash
python3 ~/.claude/plugins/ward/scripts/bootstrap.py
```

(Exact plugin install path may vary. `/ward setup` is the portable form.)

This creates:
- `~/.ward/config.json`
- `~/.ward/persona.txt`
- `~/.ward/state.json`
- `~/.ward/states/`

Existing files are preserved. Use `/ward setup --force` only if you explicitly want to overwrite the seed files.

### 3. Set Your Name

Edit `~/.ward/config.json`:

```json
{ "persona_name": "YourName" }
```

Ward will use this name when speaking to you.

### 4. Register A Project

From inside a project you want WARD to track:

```bash
ward-init
```

You can override the inferred defaults:

```bash
ward-init --name "My Project" --tasks docs/TASKS.md
```

To register a project from a different directory:

```bash
ward-init --cwd /absolute/path/to/project
```

This writes the current project entry into `~/.ward/config.json` so you do not have to edit the global config manually.

### 5. Choose Your Voice

**Option A — macOS voices (default)**

Ward uses `Joelle (Enhanced)` by default. This voice is not installed on macOS by default — install it first:

1. Open **System Settings → Accessibility → Spoken Content**
2. Click the **System Voice** dropdown → **Manage Voices...**
3. Find **Joelle (Enhanced)** under English and click the download icon
4. Wait for the download to complete

To use a different voice instead, list what's installed:
```bash
say -v ?
```
Then update `~/.ward/config.json`:
```json
{
  "macos_voice": "Zoe"
}
```

**Option B — ElevenLabs (recommended for best quality)**

Add to `~/.zshrc` or `~/.zprofile`:
```bash
export ELEVENLABS_API_KEY="your-key-here"
```
Then update `~/.ward/config.json`:
```json
{
  "tts_provider": "elevenlabs",
  "elevenlabs_voice_id": "21m00Tcm4TlvDq8ikWAM"
}
```
Find voice IDs at https://elevenlabs.io/voice-library.
Recommended voices: Adam (natural male), Rachel (natural female).
Model is set to `eleven_turbo_v2` by default for lowest latency (~500ms).

## Optional Brain Overrides

WARD can also use OpenAI or Anthropic, either globally or only for selected modes.

### Keep Ollama As Default

Fresh installs already seed:
```json
{
  "brain_provider": "ollama",
  "brain_model": "gemma4:e4b",
  "ollama_host": "http://127.0.0.1:11434",
  "ollama_think": false
}
```

`ollama_think: false` is the recommended default for WARD. It reduces the chance that a local thinking-capable model emits extra reasoning content when WARD really needs a short answer or valid JSON.

### Add OpenAI For Selected Tasks

Add to `~/.zshrc` or `~/.zprofile`:
```bash
export WARD_OPENAI_API_KEY="sk-..."
```

`OPENAI_API_KEY` also works if you already use that name elsewhere.

You can also override models by event or mode:
```json
{
  "brain_provider": "ollama",
  "brain_model": "gemma4:e4b",
  "brain_providers": {
    "state": "openai"
  },
  "brain_models": {
    "state": "gpt-5.4-nano"
  },
  "ollama_think": false
}
```

Resolution order is:
- `brain_models["event:mode"]`
- `brain_models["event"]`
- `brain_models["mode"]`
- `brain_models["default"]`
- `brain_model`

For WARD's current behavior, a practical split is:
- `post_response:decision` → local `gemma4:e4b`
- `summary_request:summary` → local `gemma4:e4b`
- `state` → `gpt-5.4-nano` if you want richer recap extraction

`post_response:decision` is the proactive turn-review path.

### Use Anthropic Instead

Add to `~/.zshrc` or `~/.zprofile`:
```bash
export WARD_ANTHROPIC_API_KEY="sk-ant-..."
```

> Use `WARD_ANTHROPIC_API_KEY` if you authenticate Claude Code via claude.ai. `ANTHROPIC_API_KEY` also works if you prefer API key auth for everything.

Then set:
```json
{
  "brain_provider": "anthropic",
  "brain_model": "claude-haiku-4-5-20251001"
}
```

## Tune Proactive Behavior

You can tune how often Ward is allowed to comment:
```json
{
  "proactive": {
    "enabled": true,
    "cooldown_seconds": 30,
    "long_response_chars": 900,
    "min_response_chars": 140,
    "conversation_min_chars": 60,
    "significant_file_count": 3,
    "max_recent_ward_lines": 10
  }
}
```

What these do:
- `enabled` turns proactive comments on or off
- `cooldown_seconds` prevents Ward from speaking too often across consecutive turns
- `long_response_chars` marks a reply as “too long to read aloud” and favors a short handoff
- `conversation_min_chars` is the floor for letting pure chat turns (no tools, no code) reach the brain so Ward can chime in as a buddy; the brain still decides whether to speak
- `significant_file_count` helps distinguish meaningful implementation turns from small edits
- `max_recent_ward_lines` controls how much recent Ward speech is kept in state to avoid repetition

Since Gemma runs locally and is free to call, the defaults favor Ward being a conversational buddy rather than a strict critic. Raise `cooldown_seconds` or `conversation_min_chars` if he gets chatty.

## Add More Projects

You can register projects automatically with:
```bash
ward-init
```

Or edit `~/.ward/config.json` manually:
```json
{
  "projects": {
    "/Users/yourname/projects/myapp": {
      "tasks_md_path": "TASKS.md",
      "project_name": "My App"
    }
  }
}
```
`tasks_md_path` is relative to the project root.

WARD is project-aware, not project-local:
- install is global
- config/persona live in `~/.ward`
- task mapping and per-project state are selected by the current working directory

### 6. Personalize Ward's persona (optional)

Edit `~/.ward/persona.txt` to add your project context, tech stack, and tone preferences.
`{persona_name}` is substituted at runtime — leave it as-is.

## Usage

Ward runs automatically — no commands needed for daily use.

| When | What happens |
|---|---|
| Open Claude Code | Ward recaps your last session and top priorities |
| Tool call fails | Ward reacts briefly |
| After a meaningful turn | Ward may give a short confirmation, risk flag, or handoff |
| Close Claude Code | Ward saves a session summary to state.json |

Proactive behavior is gated hard before the model is called:
- routine reads and tiny edits stay silent
- long assistant replies get a short handoff instead of a spoken recap
- the last turn and recent Ward lines are stored so repetition is avoided where possible

### Manual Commands

```
/recap                 — Re-sync Ward from your tasks file (active sections only)
/recap full            — Re-sync Ward from your full tasks file
/summary               — Ask Ward to summarize the last long reply he saved for later
/ward-init             — Register the current project in ~/.ward/config.json
/ward status           — Print current brain / voice / proactive config and registered projects
/ward setup [--force]  — Seed or re-seed ~/.ward/ (normally automatic on first hook fire)
/ward voice <name>     — Set macOS voice or ElevenLabs voice id
/ward brain <provider> [model]  — Switch brain_provider (ollama|openai|anthropic) and model
/ward proactive on|off|cooldown N|chat N   — Toggle or tune proactive commentary
/ward doctor           — Check Ollama reachability, API keys, and config health
```

Run `/recap` any time your priorities shift mid-session or at the start of a new week.
Run `/summary` after Ward says he left the detailed breakdown in chat and you want the spoken version.
Run `/ward doctor` if Ward is silent when you expect him to speak.

## Troubleshooting

**Ward is silent on session start**
- Run `/ward doctor` to check Ollama reachability, keys, TTS, and config health in one shot
- If you installed via the legacy npm path, verify the hooks are wired into `~/.claude/settings.json`; the plugin install path wires them automatically
- Confirm Python 3.9+ is available: `python3 --version`
- Run `/ward setup` if `~/.ward/config.json` or `~/.ward/persona.txt` does not exist yet

**Ward is using the wrong model**
- Confirm `brain_provider` and `brain_model` in `~/.ward/config.json`
- If you use overrides, check `brain_models` for `post_response:decision`, `post_response`, `state`, or `event:mode` entries
- Make sure the chosen API key matches the selected provider

**Ward is too chatty or too quiet**
- Tune `proactive.cooldown_seconds`, `proactive.long_response_chars`, and `proactive.significant_file_count`
- If you want no proactive comments at all, set `proactive.enabled` to `false`
- Remember that Ward is designed to stay silent on routine turns

**ElevenLabs not working, Ward falls back to macOS voice**
- Check `ELEVENLABS_API_KEY` is set and valid
- Confirm `tts_provider` is `"elevenlabs"` in `~/.ward/config.json`
- Check network connectivity to `api.elevenlabs.io`

**Ward has the wrong task context**
- Run `/recap` to re-sync from your tasks file
- Confirm `tasks_md_path` in `~/.ward/config.json` points to the right file

**Session summary not saving**
- This can happen if Claude Code crashes instead of exiting cleanly
- Run `/recap` manually at the start of your next session to re-sync

## Cost

Ward defaults to local Ollama, so the primary text-generation path can run with no remote API cost at all.
OpenAI and Anthropic remain optional if you want targeted overrides or a hosted-only setup.
ElevenLabs Turbo v2 is approximately $0.0003 per spoken line.

## Version

Current version: 1.3.0
See [CHANGELOG.md](CHANGELOG.md) for full version history.
