# WARD — Workspace Aware Recap Daemon
## Claude Code Plugin · Technical Specification v1.0.0

**Author:** Jun (Eleazar G. Junsan)
**Created:** April 15, 2026
**Status:** Ready for Implementation

---

## 1. Overview

**WARD** (Workspace Aware Recap Daemon) is a Claude Code plugin that provides a peer developer voice presence during coding sessions. Its persona is **Ward** — a senior developer who rides shotgun while you work. Ward greets you at session start with a recap of your last session and top priorities, reacts to errors and blockers in real time, and wraps up the session with a written summary. Designed to feel like a real developer on a call — not a narrator, not a robot reading logs.

**Name:** WARD — Workspace Aware Recap Daemon
**Persona:** Ward
**Design Philosophy:** Fail toward silence. Speak only when there is something worth saying. 1–2 sentences maximum per response.

---

## 2. Repository Structure

```
ward/
├── .claude-plugin/
│   └── plugin.json                  # Plugin manifest
├── hooks/
│   ├── session_start.py             # Fires on SessionStart
│   ├── post_tool_use.py             # Fires on PostToolUseFailure
│   └── session_end.py               # Fires on SessionEnd
├── scripts/
│   ├── brain.py                     # Claude Haiku API caller
│   └── speak.py                     # TTS dispatcher (macOS → ElevenLabs)
├── commands/
│   └── recap.md                     # /recap slash command
├── persona.txt                      # Peer developer system prompt
├── config.json                      # User preferences (voice, provider, projects)
├── state.json                       # Hot session memory (written each session)
├── CHANGELOG.md                     # Version history
└── README.md                        # Setup and usage instructions
```

---

## 3. Plugin Manifest

**File:** `.claude-plugin/plugin.json`

```json
{
  "name": "ward",
  "description": "WARD — Workspace Aware Recap Daemon. A peer developer voice presence for Claude Code. Ward greets you, recaps your last session, reacts to errors, and wraps up when you're done.",
  "version": "1.0.0",
  "author": {
    "name": "Eleazar G. Junsan",
    "url": "https://github.com/eljun"
  },
  "repository": "https://github.com/eljun/ward",
  "license": "MIT",
  "requires": {
    "claude_code": ">=2.1.0",
    "python": ">=3.9"
  }
}
```

---

## 4. Configuration

### 4.1 config.json

Stored at `~/.ward/config.json`. Created on first run if absent.

```json
{
  "tts_provider": "macos",
  "macos_voice": "Joelle (Enhanced)",
  "elevenlabs_voice_id": "21m00Tcm4TlvDq8ikWAM",
  "elevenlabs_model": "eleven_turbo_v2",
  "persona_name": "Dev",
  "speak_on": ["session_start", "errors", "session_end"],
  "projects": {
    "/Users/jun/projects/kwentalk": {
      "tasks_md_path": "TASKS.md",
      "project_name": "KwenTalk"
    },
    "/Users/jun/projects/pipelineforge": {
      "tasks_md_path": "TASKS.md",
      "project_name": "PipelineForge"
    }
  }
}
```

**Field Reference:**

| Field | Type | Default | Description |
|---|---|---|---|
| `tts_provider` | string | `"macos"` | `"macos"` or `"elevenlabs"` |
| `macos_voice` | string | `"Joelle (Enhanced)"` | Any installed macOS voice name. `Joelle (Enhanced)` must be downloaded via System Settings → Accessibility → Spoken Content → Manage Voices |
| `elevenlabs_voice_id` | string | — | ElevenLabs voice ID from their voice library |
| `elevenlabs_model` | string | `"eleven_turbo_v2"` | ElevenLabs model. Use turbo for speed |
| `persona_name` | string | `"Dev"` | Your name — what Ward calls you. Substituted into `persona.txt` at runtime |
| `speak_on` | array | see above | Which events trigger voice |
| `projects` | object | `{}` | Per-project config keyed by absolute path |

### 4.2 Environment Variables

Set in `~/.zshrc` or `~/.zprofile`:

```bash
export WARD_ANTHROPIC_API_KEY="sk-ant-..." # Preferred — avoids conflict with Claude Code's own auth
export ANTHROPIC_API_KEY="sk-ant-..."      # Also works if WARD_ANTHROPIC_API_KEY is not set
export ELEVENLABS_API_KEY="..."            # Optional — only if tts_provider is elevenlabs
```

> If you use Claude Code via claude.ai login, set `WARD_ANTHROPIC_API_KEY` instead of
> `ANTHROPIC_API_KEY` to avoid the "auth conflict" warning. Both point to the same key value.

### 4.3 state.json

Stored at `~/.ward/state.json`. Written by `session_end.py` and `/recap`. Read by `session_start.py`.

```json
{
  "current_task": "Chat V2 clean-room implementation — KwenTalk",
  "top_priorities": [
    "Complete Task 153 — V2 Chat testing",
    "Merge Task 152 — persistence ordering fix",
    "Task 146 — guest incoming recovery (HIGH, planned)"
  ],
  "recent_completions": [
    "Task 140-144 — Chat reliability bundle shipped Mar 13",
    "Task 150 — Embed and Business chat widgets consolidated"
  ],
  "pending_prs": [
    "PR #128 — Task 133 rate limits update",
    "PR #127 — Task 132 widget embedding tier fix"
  ],
  "last_summary": "Spent the session on V2 chat testing. Persistence ordering is clean. Guest recovery still planned.",
  "last_active": "2026-04-14",
  "project": "KwenTalk",
  "tasks_md_path": "/Users/jun/projects/kwentalk/TASKS.md"
}
```

---

## 5. Hooks

### 5.1 session_start.py

**Trigger:** `SessionStart` — fires when Claude Code opens or resumes a session.

**Behavior:**
1. Detect current working directory
2. Look up project config from `config.json`
3. Read `state.json`
4. If `last_active` is today → skip recap, say brief greeting only
5. If `last_active` is a previous day → send state to `brain.py` for recap speech
6. Call `speak.py` with the generated text

**Brain prompt context sent:**
```
Event: session_start
Last active: {last_active}
Current task: {current_task}
Top priorities: {top_priorities}
Pending PRs: {pending_prs}
Last summary: {last_summary}
Project: {project}
```

**Example outputs:**
- New day: *"Morning Jun — you left off testing the V2 chat. Two PRs still waiting to merge and Task 146 guest recovery is your next HIGH priority."*
- Same day resume: *"Welcome back."*

**Edge cases:**
- `state.json` missing → *"No session history yet. Run /recap to sync from your tasks file."*
- Project not in config → greet without task context, suggest adding to config

---

### 5.2 post_tool_use.py

**Trigger:** `PostToolUseFailure` — fires only when a tool call fails. No silent-pass filtering needed.

**Behavior:**
- Extract `tool_name` and `tool_error` from hook payload
- Send to `brain.py`
- Speak result

**Brain prompt context sent:**
```
Event: tool_error
Tool: {tool_name}
Error: {tool_error}
```

**Example outputs:**
- Bash error: *"That bash command failed — looks like a permission issue on that directory."*
- Write error: *"File write didn't go through. Might be a path problem."*

**Silence threshold:** If the same tool errors twice in a row with the same error, speak only once. Do not repeat.

---

### 5.3 session_end.py

**Trigger:** `SessionEnd` — fires when Claude Code exits.

**Behavior:**
1. Collect session context from Claude Code's session transcript path (available in hook payload)
2. Send to `brain.py` with instruction to summarize as state update
3. Write result to `state.json`
4. Speak brief wrap-up

**Brain prompt context sent:**
```
Event: session_end
Session transcript: {last N tool events and responses}
Previous state: {current state.json}
Instruction: Update state.json fields. Return JSON only.
```

**Speak output example:**
- *"Alright, wrapping up. I've saved your session summary."*

**Failure handling:** If session_end hook doesn't fire (crash, force quit), `state.json` retains its last valid state. Stale but not broken.

---

## 6. Scripts

### 6.1 brain.py

Single-responsibility: receive event context, call Claude Haiku API, return speech text or updated state JSON.

```python
# Signature
def run(event: str, context: dict, mode: str = "speak") -> str:
    """
    event: session_start | tool_error | session_end | recap
    context: dict of relevant fields per event type
    mode: "speak" returns 1-2 sentence string | "state" returns JSON string
    """
```

**API Call:**
```python
import anthropic, os, json

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

def run(event, context, mode="speak"):
    config = json.load(open(os.path.expanduser("~/.ward/config.json")))
    persona_name = config.get("persona_name", "Dev")
    persona = open(os.path.expanduser("~/.ward/persona.txt")).read()
    persona = persona.replace("{persona_name}", persona_name)
    
    user_message = f"Event: {event}\nContext: {json.dumps(context)}\nMode: {mode}"
    
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=150 if mode == "speak" else 500,
        system=persona,
        messages=[{"role": "user", "content": user_message}]
    )
    
    return response.content[0].text
```

**Cost note:** Haiku at $0.0008/1K input tokens. A full session (4–6 hook fires) costs under $0.01.

---

### 6.2 speak.py

Single-responsibility: receive text string, speak it using configured provider.

```python
# Fallback chain:
# 1. Try ElevenLabs if tts_provider == "elevenlabs" and ELEVENLABS_API_KEY set
# 2. Fall back to macOS `say` if ElevenLabs fails or not configured
# 3. If macOS `say` fails (non-Mac), write to stderr silently — never crash

def speak(text: str):
    config = load_config()
    if config["tts_provider"] == "elevenlabs" and os.environ.get("ELEVENLABS_API_KEY"):
        try:
            _speak_elevenlabs(text, config)
            return
        except Exception:
            pass  # fall through to macOS
    _speak_macos(text, config)

def _speak_elevenlabs(text, config):
    # POST to https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream
    # Stream audio bytes → play with afplay (macOS) or subprocess
    ...

def _speak_macos(text, config):
    voice = config.get("macos_voice", "Ava")
    subprocess.run(["say", "-v", voice, text])
```

**ElevenLabs streaming call:**
```
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream
Headers: xi-api-key: {ELEVENLABS_API_KEY}
Body: {
  "text": "{text}",
  "model_id": "eleven_turbo_v2",
  "voice_settings": { "stability": 0.5, "similarity_boost": 0.75 }
}
→ pipe response bytes to: afplay -
```

---

## 7. Persona Prompt

**File:** `~/.ward/persona.txt`

> This file is user-editable. Add your own project context, working style, and tone preferences.
> `{persona_name}` is substituted at runtime by `brain.py` using the value from `config.json`.

```
You are Ward, a senior software engineer pair-programming with {persona_name}.

WARD stands for Workspace Aware Recap Daemon. You are the daemon — always present,
always aware of the workspace, always ready with context. You ride shotgun while {persona_name} drives.

{persona_name} is a software professional who directs AI tools to build software.
Add project-specific context here: tech stack, active projects, working style, etc.

Your job:
- Speak like a real developer on a call. Casual, direct, occasionally dry.
- NEVER narrate what {persona_name} can see on screen.
- NEVER read out reasoning or implementation details.
- NEVER repeat something you said in the last 3 responses.
- Keep every response to 1–2 sentences maximum.
- Speak only when there is something worth saying.

When mode is "speak":
- Return only the spoken text. No quotes, no labels, no markdown.
- Example good response: "Auth middleware is done — want to wire up the tests next?"
- Example bad response: "I have successfully completed the authentication middleware implementation as requested."

When mode is "state":
- Return only valid JSON matching the state.json schema. No prose, no explanation.

Silence is better than noise. When in doubt, say nothing.
```

---

## 8. The /recap Command

**File:** `commands/recap.md`

```markdown
---
description: Sync session state from your tasks file. Reads In Progress, Planned, Ready to Ship, and Known Issues sections. Speaks your top priorities and updates state.json.
---

Read the tasks file for the current project at the path configured in ~/.ward/config.json.

Steps:
1. Find the tasks_md_path for the current working directory from config.json
2. If no path configured, ask the user to provide the path to their tasks file
3. Extract ONLY these sections from the file: "## In Progress", "## Planned", "## Ready to Ship", "## Known Issues"
4. Send extracted content to brain.py with event="recap" and mode="state" to generate updated state.json fields
5. Write the result to ~/.ward/state.json
6. Call speak.py with a 1-2 sentence summary of what was found

If /recap is run with the argument "full", read the entire tasks file instead of just the active sections.

Example spoken output after recap:
"Synced. You've got six tasks in progress, Task 146 is your next HIGH priority, and two PRs still waiting to merge."
```

---

## 9. Version Tracking

**File:** `CHANGELOG.md`

```markdown
# Changelog

All notable changes to Voice Companion are tracked here.
Format: [version] — date — description

---

## [1.0.0] — 2026-04-15

### Initial Release — WARD (Workspace Aware Recap Daemon)
- Persona: Ward — senior peer developer voice presence
- SessionStart hook — reads state.json, speaks daily recap
- PostToolUse hook — speaks on tool errors only, silent otherwise
- SessionStop hook — summarizes session, writes state.json
- /recap command — parses tasks.md active sections, updates state.json
- brain.py — Claude Haiku API caller with Ward peer persona
- speak.py — macOS say → ElevenLabs fallback chain
- persona.txt — Ward persona system prompt, Jun-specific context
- config.json — per-project tasks_md_path, voice provider settings
- state.json — hot session memory (current task, priorities, pending PRs)
```

Version field in `plugin.json` is the canonical version. `CHANGELOG.md` is the human-readable history. Both must be updated together on every release.

**Versioning convention:**
- `1.0.x` — bug fixes, persona tuning
- `1.x.0` — new hook events, new commands
- `x.0.0` — architecture changes, breaking config changes

---

## 10. README.md

```markdown
# WARD — Workspace Aware Recap Daemon

A peer developer voice presence for Claude Code.
**Ward** greets you at session start, recaps your last session, reacts to errors,
and wraps up when you're done.

> WARD — **W**orkspace **A**ware **R**ecap **D**aemon

## Install

\```bash
claude plugin install github.com/eljun/ward
\```

## First-Time Setup

### 1. Set your Anthropic API key (required)

Add to ~/.zshrc or ~/.zprofile:
\```bash
export ANTHROPIC_API_KEY="sk-ant-..."
\```

### 2. Choose your voice

**Option A — macOS voices (default, zero setup)**

Ward uses Ava by default. To use a different voice, list available voices:
\```bash
say -v ?
\```
Then update ~/.ward/config.json:
\```json
{ "macos_voice": "Zoe" }
\```

**Option B — ElevenLabs (recommended for best quality)**

Add to ~/.zshrc or ~/.zprofile:
\```bash
export ELEVENLABS_API_KEY="your-key-here"
\```
Then update ~/.ward/config.json:
\```json
{
  "tts_provider": "elevenlabs",
  "elevenlabs_voice_id": "21m00Tcm4TlvDq8ikWAM"
}
\```
Find voice IDs at https://elevenlabs.io/voice-library.
Recommended voices: Adam (natural male), Rachel (natural female).
Model is set to eleven_turbo_v2 by default for lowest latency (~500ms).

### 3. Add your projects

Edit ~/.ward/config.json and add your project paths:
\```json
{
  "projects": {
    "/Users/yourname/projects/myapp": {
      "tasks_md_path": "TASKS.md",
      "project_name": "My App"
    }
  }
}
\```
tasks_md_path is relative to the project root.

## Usage

Ward runs automatically — no commands needed for daily use.

| When | What happens |
|---|---|
| Open Claude Code | Ward recaps your last session and top priorities |
| Tool error occurs | Ward reacts briefly |
| Close Claude Code | Ward saves a session summary to state.json |

### Manual Commands

\```
/recap         — Re-sync Ward from your tasks file (active sections only)
/recap full    — Re-sync Ward from your full tasks file
\```

Run /recap any time your priorities shift mid-session or at the start of a new week.

## Persona

Ward is your peer developer — senior, direct, occasionally dry. He knows your projects,
knows where you left off, and speaks only when there is something worth saying.

The persona is defined in ~/.ward/persona.txt. Edit it to add your own project context,
working style preferences, or tone adjustments.

## Troubleshooting

**Ward is silent on session start**
- Check that ANTHROPIC_API_KEY is set: echo $ANTHROPIC_API_KEY
- Confirm Python 3.9+ is available: python3 --version

**ElevenLabs not working, Ward falls back to macOS voice**
- Check ELEVENLABS_API_KEY is set and valid
- Confirm tts_provider is set to "elevenlabs" in config.json
- Check network connectivity to api.elevenlabs.io

**Ward has the wrong task context**
- Run /recap to re-sync from your tasks file
- Confirm tasks_md_path in config.json points to the right file

**Session summary not saving**
- This can happen if Claude Code crashes instead of exiting cleanly
- Run /recap manually at the start of your next session to re-sync

## Cost

Ward uses Claude Haiku for all AI calls.
A full day of sessions (6–10 hook fires) costs under $0.05.
ElevenLabs Turbo v2 is approximately $0.0003 per spoken line.

## Version

Current version: 1.0.0
See CHANGELOG.md for full version history.
```

---

## 11. Implementation Notes for Claude Code

When building this plugin, follow this order:

1. Create directory structure exactly as defined in Section 2
2. Write `plugin.json` manifest first — Claude Code reads this on install
3. Write `speak.py` and test with `python3 speak.py "test"` before wiring hooks
4. Write `brain.py` and test standalone with a mock context dict
5. Write hooks in order: `session_start.py` → `session_end.py` → `post_tool_use.py`
6. Write `persona.txt` — treat this as a first-class deliverable, not boilerplate
7. Write `recap.md` command
8. Create default `config.json` and `state.json` templates
9. Write `README.md` and `CHANGELOG.md`
10. Test end-to-end by installing locally: `claude plugin install --local ./ward`

**Python dependencies required:**
```
anthropic>=0.25.0
requests>=2.31.0
```

Add a `requirements.txt` at plugin root. Hooks must install deps on first run if absent:
```python
import subprocess, sys
subprocess.check_call([sys.executable, "-m", "pip", "install", "-r",
    os.path.join(os.path.dirname(__file__), "../requirements.txt"), "-q"])
```

**Hook payload reference:**
All hooks receive a JSON payload via stdin. Key fields:

```json
// SessionStart
{
  "hook_event_name": "SessionStart",
  "session_id": "...",
  "cwd": "/path/to/project",
  "transcript_path": "/path/to/transcript.jsonl",
  "source": "startup|resume|clear|compact"
}

// PostToolUseFailure  ← WARD uses this, not PostToolUse
{
  "hook_event_name": "PostToolUseFailure",
  "session_id": "...",
  "tool_name": "Bash|Write|Edit|Read|...",
  "tool_input": {},
  "tool_error": "error message string",
  "tool_use_id": "toolu_01..."
}

// PostToolUse (reference only — WARD does not hook this event)
// tool_response structure varies per tool:
//   Bash:       { "stdout": "...", "stderr": "...", "exit_code": 0 }
//   Write/Edit: { "filePath": "...", "success": true }
//   Read:       { "filePath": "...", "success": true, "content": "..." }

// SessionEnd
{
  "hook_event_name": "SessionEnd",
  "session_id": "...",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/path/to/project",
  "reason": "clear|resume|logout|prompt_input_exit|bypass_permissions_disabled|other"
}
```

---

## 12. Future Versions (Post-Validation)

Do not build these in v1. Validate the peer feeling first.

| Feature | Target Version |
|---|---|
| Daily log files (append-only JSONL per day) | v1.1.0 |
| "What did we do last week?" query | v1.1.0 |
| `/status` command — current git branch + task context | v1.2.0 |
| Decision point detection (ambiguous tool sequences) | v1.2.0 |
| Local SQLite instead of JSONL logs | v2.0.0 |
| Multiple persona profiles | v2.0.0 |
