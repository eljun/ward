# WARD — Workspace Aware Recap Daemon

A peer developer voice presence for Claude Code.
**Ward** greets you at session start, recaps your last session, reacts to tool failures,
and can proactively comment after a turn when there is something actually worth saying.
The goal is not narration. The goal is a quiet senior dev riding shotgun.

> WARD — **W**orkspace **A**ware **R**ecap **D**aemon

## Install

```bash
claude plugin install github.com/eljun/ward
```

## First-Time Setup

### 1. Set your AI provider key (required)

Add to `~/.zshrc` or `~/.zprofile`:
```bash
export WARD_ANTHROPIC_API_KEY="sk-ant-..."
```

> Use `WARD_ANTHROPIC_API_KEY` if you authenticate Claude Code via claude.ai — this avoids
> an auth conflict warning. `ANTHROPIC_API_KEY` also works if you prefer API key auth for everything.

Or use OpenAI instead:
```bash
export WARD_OPENAI_API_KEY="sk-..."
```

`OPENAI_API_KEY` also works if you already use that name elsewhere.

### 2. Set your name

Edit `~/.ward/config.json`:
```json
{ "persona_name": "YourName" }
```
Ward will use this name when speaking to you.

### 3. Choose your brain model

WARD can use either Anthropic or OpenAI for its text generation.

OpenAI default:
```json
{
  "brain_provider": "openai",
  "brain_model": "gpt-5.4-nano"
}
```

Anthropic example:
```json
{
  "brain_provider": "anthropic",
  "brain_model": "claude-haiku-4-5-20251001"
}
```

You can also override models by event or mode:
```json
{
  "brain_provider": "openai",
  "brain_model": "gpt-5.4-nano",
  "brain_models": {
    "post_response:decision": "gpt-5.4-nano",
    "state": "gpt-5.4-mini"
  }
}
```

Resolution order is:
- `brain_models["event:mode"]`
- `brain_models["event"]`
- `brain_models["mode"]`
- `brain_models["default"]`
- `brain_model`

For WARD's current behavior, a practical split is:
- `post_response:decision` → `gpt-5.4-nano`
- `state` → `gpt-5.4-mini`

`post_response:decision` is the proactive turn-review path.

### 3.1 Tune proactive behavior

You can tune how often Ward is allowed to comment:
```json
{
  "proactive": {
    "enabled": true,
    "cooldown_seconds": 90,
    "long_response_chars": 900,
    "min_response_chars": 140,
    "significant_file_count": 3,
    "max_recent_ward_lines": 5
  }
}
```

What these do:
- `enabled` turns proactive comments on or off
- `cooldown_seconds` prevents Ward from speaking too often across consecutive turns
- `long_response_chars` marks a reply as “too long to read aloud” and favors a short handoff
- `significant_file_count` helps distinguish meaningful implementation turns from small edits
- `max_recent_ward_lines` controls how much recent Ward speech is kept in state to avoid repetition

### 4. Choose your voice

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
{ "macos_voice": "Zoe" }
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

### 5. Add your projects

Edit `~/.ward/config.json`:
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
/recap         — Re-sync Ward from your tasks file (active sections only)
/recap full    — Re-sync Ward from your full tasks file
```

Run `/recap` any time your priorities shift mid-session or at the start of a new week.

## Troubleshooting

**Ward is silent on session start**
- Check that your configured provider key is set:
- `echo $WARD_ANTHROPIC_API_KEY`
- `echo $WARD_OPENAI_API_KEY`
- Confirm Python 3.9+ is available: `python3 --version`
- Run `python3 scripts/speak.py "test"` from the ward repo to test TTS

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

Ward can use Anthropic or OpenAI for AI calls. Cost depends on the configured provider and model.
ElevenLabs Turbo v2 is approximately $0.0003 per spoken line.

## Version

Current version: 1.1.0
See [CHANGELOG.md](CHANGELOG.md) for full version history.
