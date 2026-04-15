# WARD — Workspace Aware Recap Daemon

A peer developer voice presence for Claude Code.
**Ward** greets you at session start, recaps your last session, reacts to errors,
and wraps up when you're done.

> WARD — **W**orkspace **A**ware **R**ecap **D**aemon

## Install

```bash
claude plugin install github.com/eljun/ward
```

## First-Time Setup

### 1. Set your Anthropic API key (required)

Add to `~/.zshrc` or `~/.zprofile`:
```bash
export WARD_ANTHROPIC_API_KEY="sk-ant-..."
```

> Use `WARD_ANTHROPIC_API_KEY` if you authenticate Claude Code via claude.ai — this avoids
> an auth conflict warning. `ANTHROPIC_API_KEY` also works if you prefer API key auth for everything.

### 2. Set your name

Edit `~/.ward/config.json`:
```json
{ "persona_name": "YourName" }
```
Ward will use this name when speaking to you.

### 3. Choose your voice

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

### 4. Add your projects

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

### 5. Personalize Ward's persona (optional)

Edit `~/.ward/persona.txt` to add your project context, tech stack, and tone preferences.
`{persona_name}` is substituted at runtime — leave it as-is.

## Usage

Ward runs automatically — no commands needed for daily use.

| When | What happens |
|---|---|
| Open Claude Code | Ward recaps your last session and top priorities |
| Tool call fails | Ward reacts briefly |
| Close Claude Code | Ward saves a session summary to state.json |

### Manual Commands

```
/recap         — Re-sync Ward from your tasks file (active sections only)
/recap full    — Re-sync Ward from your full tasks file
```

Run `/recap` any time your priorities shift mid-session or at the start of a new week.

## Troubleshooting

**Ward is silent on session start**
- Check that `ANTHROPIC_API_KEY` is set: `echo $ANTHROPIC_API_KEY`
- Confirm Python 3.9+ is available: `python3 --version`
- Run `python3 scripts/speak.py "test"` from the ward repo to test TTS

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

Ward uses Claude Haiku for all AI calls.
A full day of sessions (6–10 hook fires) costs under $0.05.
ElevenLabs Turbo v2 is approximately $0.0003 per spoken line.

## Version

Current version: 1.0.0
See [CHANGELOG.md](CHANGELOG.md) for full version history.
