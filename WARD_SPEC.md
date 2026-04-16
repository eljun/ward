# WARD — Workspace Aware Recap Daemon
## Claude Code Plugin · Technical Specification v2.0.0

**Author:** Jun (Eleazar G. Junsan)
**Created:** April 15, 2026
**Last revised:** April 16, 2026
**Status:** Plugin-native install refactor in flight (task 003). Clean-profile smoke test pending.

---

## 1. Overview

**WARD** (Workspace Aware Recap Daemon) is a Claude Code plugin that provides a peer developer voice presence during coding sessions. Its persona is **Ward** — a senior developer who rides shotgun while you work. Ward greets you at session start with a recap of your last session and top priorities, reacts to tool failures, and can proactively comment after a turn when there is real signal. The target feel is a real developer on a call — not a narrator, not a robot reading hook events.

**Name:** WARD — Workspace Aware Recap Daemon
**Persona:** Ward
**Design Philosophy:** Fail toward silence. Speak only when there is something worth saying. 1–2 sentences maximum per response.

**Install model:** Claude Code plugin, project-aware runtime. Installed at user scope via `/plugin marketplace add eljun/ward` then `/plugin install ward@ward-plugins`. No `sudo`, no `npm`, no manual `settings.json` edits. Config/persona/state live in `~/.ward`, selected at runtime by the current working directory.

### 1.1 Architecture Direction

WARD started as a hook-reactive companion: each hook event directly produced a spoken line. That design was simple but sounded robotic because the trigger itself became the content.

The current architecture direction is **stateful and turn-aware**:
- Hooks are signal sources, not scripts for what Ward should say
- `post_response.py` inspects the latest user/assistant turn rather than a raw transcript tail
- Local heuristics gate routine turns before any model call
- The model returns a structured **decision** for proactive turns, not raw speech by default
- `state.json` stores conversational memory so Ward can avoid repetition and preserve long replies for later summarization

---

## 2. Repository Structure

```
ward/
├── .claude-plugin/
│   └── plugin.json                  # Plugin manifest
├── hooks/
│   ├── session_start.py             # Fires on SessionStart
│   ├── post_tool_use.py             # Fires on PostToolUseFailure
│   ├── post_response.py             # Fires on Stop; proactive turn review
│   └── session_end.py               # Fires on SessionEnd
├── scripts/
│   ├── brain.py                     # Provider/model-configurable brain caller
│   ├── state_store.py               # Shared config/state helpers
│   └── speak.py                     # TTS dispatcher (macOS → ElevenLabs)
├── commands/
│   ├── recap.md                     # /recap slash command
│   ├── summary.md                   # /summary slash command
│   └── ward-init.md                 # /ward-init slash command
├── persona.txt                      # Peer developer system prompt
├── config.json                      # User preferences (voice, brain, proactive settings, projects)
├── state.json                       # Session + conversation memory
├── scripts/bootstrap.py             # Seeds ~/.ward on first install
├── scripts/init_project.py          # Registers current project in ~/.ward/config.json
├── CHANGELOG.md                     # Version history
└── README.md                        # Setup and usage instructions
```

---

## 3. Plugin Manifest

**File:** `.claude-plugin/plugin.json`

Claude Code auto-registers hooks declared in the manifest on install — the user does not edit `~/.claude/settings.json`. `commands/` and `skills/` are auto-discovered from the plugin root. `${CLAUDE_PLUGIN_ROOT}` is expanded at runtime to the installed plugin directory.

```json
{
  "name": "ward",
  "description": "WARD — Workspace Aware Recap Daemon. A peer developer voice presence for Claude Code.",
  "version": "2.0.0",
  "author": { "name": "Eleazar G. Junsan", "url": "https://github.com/eljun" },
  "repository": "https://github.com/eljun/ward",
  "license": "MIT",
  "requires": { "claude_code": ">=2.1.0", "python": ">=3.9" },
  "hooks": {
    "SessionStart": [{"hooks": [{"type": "command", "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/session_start.py"}]}],
    "Stop":         [{"hooks": [{"type": "command", "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/post_response.py"}]}],
    "PostToolUse":  [{"hooks": [{"type": "command", "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/post_tool_use.py"}]}],
    "SessionEnd":   [{"hooks": [{"type": "command", "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/session_end.py"}]}]
  }
}
```

### 3.1 Marketplace Manifest

**File:** `.claude-plugin/marketplace.json`

WARD publishes a marketplace-of-one so users can install without any Anthropic-approval step.

```json
{
  "name": "ward-plugins",
  "owner": { "name": "Eleazar G. Junsan", "url": "https://github.com/eljun" },
  "plugins": [
    { "name": "ward", "source": "./", "description": "Workspace Aware Recap Daemon — a peer developer voice presence for Claude Code.", "version": "2.0.0" }
  ]
}
```

Install flow:

```
/plugin marketplace add eljun/ward
/plugin install ward@ward-plugins
```

---

## 4. Configuration

### 4.1 config.json

Stored at `~/.ward/config.json`. Seeded by `scripts/bootstrap.py`.

```json
{
  "tts_provider": "macos",
  "macos_voice": "Joelle (Enhanced)",
  "elevenlabs_voice_id": "21m00Tcm4TlvDq8ikWAM",
  "elevenlabs_model": "eleven_turbo_v2",
  "persona_name": "Dev",
  "brain_provider": "ollama",
  "brain_model": "gemma4:e4b",
  "ollama_host": "http://127.0.0.1:11434",
  "ollama_think": false,
  "brain_models": {},
  "proactive": {
    "enabled": true,
    "cooldown_seconds": 90,
    "long_response_chars": 900,
    "min_response_chars": 140,
    "significant_file_count": 3,
    "max_recent_ward_lines": 5
  },
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
| `brain_provider` | string | `"ollama"` | `"openai"`, `"anthropic"`, or `"ollama"` |
| `brain_model` | string | `"gemma4:e4b"` | Base model used when no override matches |
| `brain_models` | object | `{}` | Per-event or per-mode model overrides. Resolution order: `event:mode` → `event` → `mode` → `default` → `brain_model` |
| `ollama_host` | string | `"http://127.0.0.1:11434"` | Base URL for local Ollama when `brain_provider` is `"ollama"` |
| `ollama_think` | boolean/string | `false` | Passed through to Ollama's `think` field. Recommended `false` for WARD's concise and structured outputs |
| `proactive` | object | see above | Local gating knobs for proactive turn review |
| `speak_on` | array | see above | Which events trigger voice |
| `projects` | object | `{}` | Per-project config keyed by absolute path |

### 4.2 Environment Variables

Set in `~/.zshrc` or `~/.zprofile`:

```bash
export WARD_OPENAI_API_KEY="sk-..."        # Optional — useful for hybrid overrides like state extraction
export OPENAI_API_KEY="sk-..."             # Also works if WARD_OPENAI_API_KEY is not set
export WARD_ANTHROPIC_API_KEY="sk-ant-..." # Optional if using Anthropic instead
export ANTHROPIC_API_KEY="sk-ant-..."      # Also works if WARD_ANTHROPIC_API_KEY is not set
export ELEVENLABS_API_KEY="..."            # Optional — only if tts_provider is elevenlabs
```

> The primary install path does not require a hosted LLM key because WARD defaults to local
> `ollama / gemma4:e4b`. If you use Anthropic via Claude Code login, set `WARD_ANTHROPIC_API_KEY`
> instead of `ANTHROPIC_API_KEY` to avoid the auth conflict warning. For OpenAI, prefer
> `WARD_OPENAI_API_KEY` to keep WARD isolated from other tools in your shell environment.

### 4.3 state.json

Stored at `~/.ward/state.json` or `~/.ward/states/{project}.json`. Written by `session_end.py`, `post_response.py`, and `/recap`. Read by `session_start.py`.

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
  "tasks_md_path": "/Users/jun/projects/kwentalk/TASKS.md",
  "recent_ward_lines": [
    "I left the detailed breakdown in chat."
  ],
  "last_spoken_at": "2026-04-15T09:12:04Z",
  "last_spoken_reason": "handoff",
  "last_seen_turn_signature": "a12ab1518f60d980f06fa9b8254a0582149877b4",
  "last_user_request": "Can you explain the proactive refactor plan?",
  "last_assistant_response": "Here’s the full proactive refactor plan...",
  "last_long_response": "Here’s the full proactive refactor plan...",
  "summary_offer_available": true
}
```

### 4.4 State Model Notes

`state.json` now carries two kinds of memory:
- **Session memory:** current task, priorities, pending PRs, last summary
- **Conversation memory:** recent Ward lines, the last user/assistant turn, the last long response, and proactive cooldown metadata

This is what allows Ward to stay concise, avoid saying the same thing twice, and later summarize a long assistant answer if the user asks.

### 4.5 First-Time Install Flow

Primary install flow (plugin-native):

1. Install and launch Ollama locally
2. Confirm the daemon is reachable with `ollama list`
3. Pull `gemma4:e4b` if it is not already present with `ollama pull gemma4:e4b`
4. From inside Claude Code: `/plugin marketplace add eljun/ward`
5. From inside Claude Code: `/plugin install ward@ward-plugins`
6. Register the current project with `/ward-init`

`~/.ward/` is seeded automatically on the first hook fire. `/ward setup` forces the seed ahead of that first hook. This yields a fully local-first WARD setup with no hosted-model dependency, no `sudo`, and no manual `settings.json` edits.

A legacy npm fallback is preserved at `legacy/npm/` for environments without `/plugin install`.

### 4.6 Bootstrap

Bootstrap runs automatically on the first hook fire via `scripts/bootstrap.py::ensure_ward_home_silent()`. Explicit runs are supported:

```bash
# From inside Claude Code
/ward setup
/ward setup --force

# From a shell (plugin install path)
python3 <plugin-root>/scripts/bootstrap.py
```

Behavior:
- creates `~/.ward/`
- creates `~/.ward/states/`
- copies seed `config.json`, `persona.txt`, and `state.json` if they do not already exist
- preserves existing files unless `--force` is passed
- under the plugin install path, does **not** copy slash commands into `~/.claude/commands/` (the plugin system delivers them from the repo); the legacy npm path opts into command copying with `--legacy-commands`

### 4.7 Project Registration

WARD is globally configured but project-aware. Registering a project means adding the current working directory to `~/.ward/config.json` under `projects`.

This is handled by:

```bash
python3 scripts/init_project.py
```

Behavior:
- bootstraps `~/.ward` first if needed
- infers `project_name` from the directory name unless `--name` is passed
- infers `tasks_md_path` from common task-file locations unless `--tasks` is passed
- writes or updates the matching project entry in `~/.ward/config.json`

### 4.8 Optional Hosted Overrides

WARD is Ollama-first by default, but hosted providers remain useful for targeted quality upgrades.

Practical override example:

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

This keeps proactive chatter and spoken summaries local while routing state extraction to OpenAI.

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

### 5.3 post_response.py

**Trigger:** `Stop` — fires after each completed Claude response.

**Behavior:**
1. Read the recent transcript window
2. Extract the latest user/assistant turn
3. Apply strict local gating before any model call
4. If the turn is routine → update memory only, stay silent
5. If the turn is meaningful → call `brain.py` with `mode="decision"`
6. Parse the structured decision JSON
7. Update conversation memory in `state.json`
8. Speak only if the decision says to speak

**Local gate intent:**
- Stay silent on routine reads, tiny edits, and status-only turns
- Detect meaningful signals such as risky changes, multi-file implementation turns, completions, and long replies
- Enforce cooldown so Ward does not comment on every consecutive turn

**Brain decision context sent:**
```
Event: post_response
User request: {last user text}
Assistant response: {last assistant text}
Tools: {tool summary}
Signals: {local signal tags}
Recent Ward lines: {recent_ward_lines}
Last spoken reason: {last_spoken_reason}
```

**Expected decision payload:**
```json
{
  "should_speak": true,
  "reason": "handoff",
  "speech": "I left the detailed breakdown in chat.",
  "summary_offer_available": true
}
```

**Design rule:** For long assistant replies, Ward should give a short handoff, not read the whole answer aloud. Full summarization is deferred until the user explicitly asks for it.

---

### 5.4 session_end.py

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

Single-responsibility: receive event context, call the configured provider/model, return spoken text or JSON payloads for state/decision flows.

```python
# Signature
def run(event: str, context: dict, mode: str = "speak") -> str:
    """
    event: session_start | tool_error | session_end | recap | post_response
    context: dict of relevant fields per event type
    mode: "speak" returns 1-2 sentence string
    mode: "decision" returns JSON string
    mode: "state" returns JSON string
    """
```

**Provider resolution:**
```python
provider, model = resolve_from_config(event, mode)

if provider == "openai":
    # OpenAI Responses API
    ...
elif provider == "anthropic":
    # Anthropic Messages API
    ...
```

**Current default:** `ollama / gemma4:e4b`

**Supported providers:**
- `ollama` for local models served through the Ollama daemon
- `openai`
- `anthropic`

**Recommended split:**
- `post_response:decision` → local `gemma4:e4b`
- `summary_request:summary` → local `gemma4:e4b`
- `state` → hosted override such as `gpt-5.4-nano` when you want stronger recap extraction

### 6.2 state_store.py

Single-responsibility: shared config/state helpers used by hooks so all state reads/writes go through the same schema and per-project path resolution.

---

### 6.3 bootstrap.py

Single-responsibility: initialize `~/.ward` from repo templates so first-time setup works without manual file copying.

---

### 6.4 init_project.py

Single-responsibility: register the current project in global WARD config without requiring the user to edit `~/.ward/config.json` manually.

---

### 6.5 speak.py

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
- Default to silence when the turn is routine.

When mode is "decision":
- Return only valid JSON.
- Decide whether Ward should speak after a proactive turn.
- For long replies, prefer a short handoff instead of reading the answer aloud.

When mode is "speak":
- Return only the spoken text. No quotes, no labels, no markdown.
- Example good response: "Auth middleware is done — want to wire up the tests next?"
- Example bad response: "I have successfully completed the authentication middleware implementation as requested."

When mode is "state":
- Return only valid JSON matching the state.json schema. No prose, no explanation.

Silence is better than noise. When in doubt, say nothing.
```

---

## 8. Commands

### 8.1 The /recap Command

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

### 8.2 The /summary Command

**File:** `commands/summary.md`

```markdown
---
description: Ask Ward to summarize the last long response he saved for later.
---

Ward stores the last long assistant response in state when he gives a short handoff instead of reading it aloud.

Steps:
1. Determine the WARD repo root from the location of this command file.
2. Run `python3 {ward_repo}/scripts/summary_request.py` from the current working directory.
3. If Ward says there is nothing queued for summary, tell the user no long response is currently stored.
```

**Behavior:**
- Reads the current project's WARD state file
- Uses `last_long_response` as the source material
- Calls `brain.py` with `event="summary_request"` and `mode="summary"`
- Speaks the compact summary through `speak.py`
- Clears `summary_offer_available` after a successful summary request

### 8.3 The /ward-init Command

**File:** `commands/ward-init.md`

```markdown
---
description: Register the current project in ~/.ward/config.json so WARD can track it automatically.
---

Initialize WARD for the current project without hand-editing the global config.

Steps:
1. Determine the WARD repo root from the location of this command file.
2. Run `python3 {ward_repo}/scripts/init_project.py` from the current working directory.
3. If the project is already configured, tell the user the existing mapping and mention `--force` if they want to replace it.
4. After success, tell the user to run `/recap` once in this project.
```

---

## 9. Version Tracking

**Important:** `plugin.json` is the canonical version. `CHANGELOG.md`, `README.md`, and this spec should be updated alongside it on every release.

**File:** `CHANGELOG.md`

```markdown
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

## [1.3.0] — 2026-04-15

### Ollama-First Defaults Release
- Switched the default WARD brain to local `ollama / gemma4:e4b`
- Updated the bootstrap seed config to use `gemma4:e4b` as the primary model
- Expanded install docs to cover Ollama setup, model pull/check, bootstrap, and project registration
- Clarified OpenAI and Anthropic as optional alternatives or targeted overrides
- Updated the technical spec to match the Ollama-first install and runtime model

## [1.1.0] — 2026-04-15

### Proactive Refactor Release
- Added `post_response.py` proactive turn review on `Stop`
- Shifted WARD from hook narration toward turn-aware, stateful commentary
- Added local gating and cooldowns so routine turns stay silent
- Added conversation memory to `state.json`
- Added structured `decision` mode in `brain.py`
- Added provider/model configurability and switched the default brain to `openai / gpt-5.4-nano`
- Updated `WARD_SPEC.md` and `README.md` to reflect the proactive architecture

## [1.0.0] — 2026-04-15

### Initial Release — WARD (Workspace Aware Recap Daemon)
- Persona: Ward — senior peer developer voice presence
- SessionStart hook — reads state.json, speaks daily recap
- PostToolUse hook — speaks on tool errors only, silent otherwise
- SessionStop hook — summarizes session, writes state.json
- /recap command — parses tasks.md active sections, updates state.json
- brain.py — model caller with Ward peer persona
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
and can proactively comment after meaningful turns.

> WARD — **W**orkspace **A**ware **R**ecap **D**aemon

## Install

\```bash
claude plugin install github.com/eljun/ward
\```

## First-Time Setup

### 1. Set your AI provider key (required)

Add to ~/.zshrc or ~/.zprofile:
\```bash
export WARD_OPENAI_API_KEY="sk-..."
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
| After a meaningful turn | Ward may give a short confirmation, risk flag, or handoff |
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

Ward defaults to local Ollama, so the primary text-generation path can run without remote API cost.
OpenAI and Anthropic remain optional if you want targeted overrides or a hosted-only setup.
ElevenLabs Turbo v2 is approximately $0.0003 per spoken line.

## Version

Current version: 1.3.0
See CHANGELOG.md for full version history.
```

---

## 11. Implementation Notes for Claude Code

When building this plugin, follow this order:

1. Create directory structure exactly as defined in Section 2
2. Write `plugin.json` manifest first — Claude Code reads this on install
3. Create default `config.json`, `persona.txt`, and `state.json` templates
4. Write `bootstrap.py` so first install can seed `~/.ward`
5. Write `speak.py` and test with `python3 speak.py "test"` before wiring hooks
6. Write `brain.py` and test standalone with a mock context dict
7. Write hooks in order: `session_start.py` → `post_tool_use.py` → `post_response.py` → `session_end.py`
8. Write `recap.md` and `summary.md` commands
9. Write `README.md` and `CHANGELOG.md`
10. Test end-to-end by installing locally: `claude plugin install --local ./ward`

**Python dependencies required:**
```
anthropic>=0.25.0
openai>=1.0.0
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

// Stop  ← proactive turn review
{
  "hook_event_name": "Stop",
  "session_id": "...",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/path/to/project"
}
```

---

## 12. Future Versions (Post-Validation)

Do not build these in v1. Validate the peer feeling first.

| Feature | Target Version |
|---|---|
| Daily log files (append-only JSONL per day) | v1.1.0 |
| "What did we do last week?" query | v1.1.0 |
| `/status` command — current git branch + task context | v1.3.x |
| Decision point detection (ambiguous tool sequences) | v1.3.x |
| Local SQLite instead of JSONL logs | v2.0.0 |
| Multiple persona profiles | v2.0.0 |
