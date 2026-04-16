# Plugin-Native Install Refactor — Correct The Distribution Drift

> **ID:** 3
> **Status:** PLANNED
> **Priority:** HIGH
> **Type:** refactor
> **Version Impact:** major
> **Created:** 2026-04-16
> **Platform:** CLI
> **Automation:** manual

## Overview

WARD was originally designed as a Claude Code plugin, using `.claude-plugin/plugin.json`, a `hooks/` directory of Python scripts, and a `commands/` directory of slash commands. After a misread of an error message — the Claude Code plugin install warned that a plugin needs to be "approved before it can be added to a marketplace" — the project pivoted to an `npm install -g github:eljun/ward` distribution model. That pivot carried three unintended consequences:

1. **Permission pain.** Global npm install needs write access to the system npm prefix, which on default macOS and Linux setups means `sudo`. Non-sudo users cannot install WARD without reconfiguring npm.
2. **Hooks never register.** The current `.claude-plugin/plugin.json` is skeletal (name/version/author only) and declares no `hooks`. Claude Code auto-registers plugin hooks from the manifest when the plugin is installed via the plugin system — but WARD is not installed via the plugin system, and even if it were, the manifest has nothing to register. This is the single strongest explanation for the "Ward is mute outside session start/end" symptom.
3. **Two fighting install stories.** The repo contains both `.claude-plugin/plugin.json` (plugin framing) and `package.json` + `scripts/postinstall.js` + `scripts/bootstrap.py` copying commands into `~/.claude/commands/` (npm + manual command injection framing). Documentation in `WARD_SPEC.md` still references `claude plugin install github.com/eljun/ward`, while `README.md` documents the npm path. The two paths do not meet in the middle.

The "marketplace approval" blocker was in fact a misunderstanding. Claude Code supports a self-owned **marketplace of one** pattern where a repo publishes its own `.claude-plugin/marketplace.json` and users install from it directly with `/plugin marketplace add <repo>` followed by `/plugin install <name>@<marketplace>`. No Anthropic approval is required.

This task restores WARD to its original plugin-native distribution path, fixes the hook registration gap, and retires the npm detour.

## Development Approach

**Methodology:** Standard
**Rationale:** This is a cross-cutting install and distribution refactor — manifest changes, command path rewrites, first-run bootstrap redesign, and documentation realignment. Needs explicit acceptance criteria and an ordered rollout, not ad-hoc edits.

## Requirements

### Must Have
- [ ] `.claude-plugin/plugin.json` declares all four WARD hooks (`SessionStart`, `Stop`, `PostToolUseFailure`, `SessionEnd`) using `${CLAUDE_PLUGIN_ROOT}` so they are registered automatically on plugin install.
- [ ] `.claude-plugin/marketplace.json` published so users can run `/plugin marketplace add eljun/ward` followed by `/plugin install ward@ward-plugins` without any Anthropic approval.
- [ ] `commands/*.md` no longer rely on the npm bootstrap's `{ward_repo}` string substitution. They resolve paths via `${CLAUDE_PLUGIN_ROOT}` or a plugin-relative convention that survives the plugin install.
- [ ] First-run `~/.ward/` seeding runs from inside the plugin lifecycle, not from `npm postinstall`. A small Python shim invoked by the first hook run (or by an explicit `/ward setup` command) must be sufficient to create `~/.ward/config.json`, `~/.ward/persona.txt`, `~/.ward/state.json`, and `~/.ward/states/`.
- [ ] `/ward` slash command added so users can view and edit WARD configuration without hand-editing `~/.ward/config.json`. Minimum subcommands:
  - `/ward status` — print current config summary (brain provider, voice, registered projects, proactive knobs)
  - `/ward voice <voice>` — set macOS voice or ElevenLabs voice id
  - `/ward brain <provider> [model]` — switch brain provider and model
  - `/ward proactive <on|off|cooldown N>` — toggle and tune proactive behavior
  - `/ward setup` — run or re-run `~/.ward/` bootstrap
- [ ] WARD runs end-to-end from a clean user profile with only:
  1. A running Ollama with `gemma4:e4b`
  2. `/plugin marketplace add eljun/ward`
  3. `/plugin install ward@ward-plugins`
  No `sudo`, no `npm`, no manual `~/.claude/settings.json` edits.
- [ ] Documentation (`README.md`, `WARD_SPEC.md`) reflects the plugin-native install path as primary. npm install is either deleted or clearly demoted to a fallback section.

### Nice to Have
- [ ] Retain `package.json` + `ward-bootstrap` / `ward-init` CLIs as a fallback install for environments without Claude Code (or for offline dev on WARD itself), clearly labeled as non-primary.
- [ ] `/ward doctor` subcommand that checks Ollama reachability, brain/TTS config validity, and whether hooks are registered.
- [ ] Auto-seed `~/.ward/` on first hook fire if not already present, with a short spoken "first boot" line.

## Current State

Install story as of commit on `claude/proactive-buddy-behavior-4vLS6`:

- `.claude-plugin/plugin.json` exists but only carries `name`, `description`, `version`, `author`, `repository`, `license`, and `requires`. It does **not** declare `hooks`, `commands`, or `skills`. Claude Code's plugin system therefore has nothing to wire up even if the plugin is installed via `/plugin install`.
- `package.json` declares two bins:
  - `ward-bootstrap` → `scripts/postinstall.js` → `scripts/bootstrap.py`
  - `ward-init` → `scripts/ward-init.js` → `scripts/init_project.py`
- `scripts/bootstrap.py` seeds `~/.ward/` and copies `commands/*.md` into `~/.claude/commands/`, substituting `{ward_repo}` with the npm install path so slash commands can invoke scripts directly.
- `README.md` install flow:
  ```
  npm install -g github:eljun/ward
  ward-bootstrap
  ```
- `WARD_SPEC.md:702` contradicts this, claiming the install is `claude plugin install github.com/eljun/ward`.
- Hooks are not wired anywhere. They will not fire on a fresh install unless the user edits `~/.claude/settings.json` by hand. No such instruction exists in the current README.
- Slash commands work post-bootstrap only because they are copied into `~/.claude/commands/` with the `{ward_repo}` string pre-resolved. Lose the npm path and those `python3 {ward_repo}/scripts/...` command bodies break.

## Proposed Solution

Restore and complete the plugin-native distribution path, and retire the npm path as primary.

### Target Install Flow

```
# one-time, per user
/plugin marketplace add eljun/ward
/plugin install ward@ward-plugins
/ward setup          # creates ~/.ward/, seeds config/persona/state
/ward-init           # register the current project (kept for muscle memory) or /ward register
```

That's it. No sudo, no npm, no settings.json edits, no marketplace approval.

### Architecture

- `.claude-plugin/plugin.json`
  Full manifest: name, description, version, author, repository, license, requires, **hooks**, and optional explicit `commands` / `skills` paths.
- `.claude-plugin/marketplace.json`
  Marketplace-of-one entry so `/plugin marketplace add eljun/ward` resolves to this plugin.
- `hooks/`
  Unchanged Python scripts. Invoked via `${CLAUDE_PLUGIN_ROOT}/hooks/<name>.py` from the manifest.
- `commands/`
  Existing slash commands (`recap.md`, `summary.md`, `ward-init.md`) rewritten so their bodies call `${CLAUDE_PLUGIN_ROOT}/scripts/<name>.py` instead of substituted `{ward_repo}` strings. New `ward.md` command added for config.
- `skills/ward/SKILL.md` (or similar, location TBD based on plugin skill layout)
  For the buddy skill from Task 2 — not in scope here, but the install path must leave room for it.
- `scripts/bootstrap.py`
  Kept, but no longer copies commands into `~/.claude/commands/`. It only seeds `~/.ward/`. Slash commands are delivered by the plugin system itself.
- `scripts/postinstall.js`, `scripts/ward-init.js`, `package.json`
  Either removed entirely or moved under a `legacy/` path and documented as a fallback. Decision deferred to implementation.

### File Changes

| Action | File | Description |
|--------|------|-------------|
| MODIFY | `.claude-plugin/plugin.json` | Add `hooks` block for all four events, using `${CLAUDE_PLUGIN_ROOT}` |
| CREATE | `.claude-plugin/marketplace.json` | Marketplace-of-one manifest pointing at this plugin |
| MODIFY | `commands/recap.md` | Replace `{ward_repo}` with `${CLAUDE_PLUGIN_ROOT}` |
| MODIFY | `commands/summary.md` | Replace `{ward_repo}` with `${CLAUDE_PLUGIN_ROOT}` |
| MODIFY | `commands/ward-init.md` | Replace `{ward_repo}` with `${CLAUDE_PLUGIN_ROOT}` |
| CREATE | `commands/ward.md` | New `/ward` slash command with status / voice / brain / proactive / setup / doctor |
| CREATE | `scripts/ward_config.py` | Backing script for `/ward` subcommands |
| MODIFY | `scripts/bootstrap.py` | Stop copying commands into `~/.claude/commands/`; only seed `~/.ward/` |
| MODIFY | `hooks/*.py` | Call a shared `ensure_ward_home()` on first fire so `/ward setup` is not strictly required |
| MODIFY | `README.md` | Replace npm install section with `/plugin marketplace add` + `/plugin install` |
| MODIFY | `WARD_SPEC.md` | Align install flow with plugin-native path; remove outdated npm references |
| MODIFY | `CHANGELOG.md` | Note the distribution change as the next major version bump |
| MODIFY or DELETE | `package.json`, `scripts/postinstall.js`, `scripts/ward-init.js` | Either remove or demote under a legacy label |

## Implementation Steps

### Step 1: Confirm Manifest Schema Against Live Claude Code

Before writing the manifest, verify the current Claude Code plugin schema against official docs:
- https://code.claude.com/docs/en/plugins-reference.md
- https://code.claude.com/docs/en/plugin-marketplaces.md
- https://code.claude.com/docs/en/discover-plugins.md

Confirm:
- Exact `hooks` shape (array of `{hooks: [{type, command}]}` per event)
- Whether `commands/` and `skills/` are auto-discovered or require an explicit manifest field
- `${CLAUDE_PLUGIN_ROOT}` expansion rules
- Skill file location inside a plugin (`skills/<name>/SKILL.md` vs. flat `commands/<name>.md`)

### Step 2: Rewrite `.claude-plugin/plugin.json`

Add the `hooks` block. Keep the existing metadata fields. Example shape (to be adjusted per Step 1 findings):

```json
{
  "name": "ward",
  "description": "WARD — Workspace Aware Recap Daemon. Peer developer voice presence for Claude Code.",
  "version": "2.0.0",
  "author": {"name": "Eleazar G. Junsan", "url": "https://github.com/eljun"},
  "repository": "https://github.com/eljun/ward",
  "license": "MIT",
  "requires": {"claude_code": ">=2.1.0", "python": ">=3.9"},
  "hooks": {
    "SessionStart":       [{"hooks": [{"type": "command", "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/session_start.py"}]}],
    "Stop":               [{"hooks": [{"type": "command", "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/post_response.py"}]}],
    "PostToolUseFailure": [{"hooks": [{"type": "command", "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/post_tool_use.py"}]}],
    "SessionEnd":         [{"hooks": [{"type": "command", "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/session_end.py"}]}]
  }
}
```

### Step 3: Publish The Marketplace Manifest

Create `.claude-plugin/marketplace.json`:

```json
{
  "name": "ward-plugins",
  "owner": {"name": "Eleazar G. Junsan"},
  "plugins": [
    {
      "name": "ward",
      "source": "./",
      "description": "Workspace Aware Recap Daemon — a peer developer voice presence for Claude Code.",
      "version": "2.0.0"
    }
  ]
}
```

Users install via:
```
/plugin marketplace add eljun/ward
/plugin install ward@ward-plugins
```

### Step 4: Rewrite Commands To Use `${CLAUDE_PLUGIN_ROOT}`

Replace every `{ward_repo}` placeholder in `commands/recap.md`, `commands/summary.md`, and `commands/ward-init.md` with `${CLAUDE_PLUGIN_ROOT}`. Remove the string-substitution logic in `scripts/bootstrap.py` since Claude Code expands `${CLAUDE_PLUGIN_ROOT}` at execution time.

### Step 5: Add `/ward` Config Command

Create `commands/ward.md` dispatching to `scripts/ward_config.py`. Minimum subcommands:
- `/ward status` → print current config summary and registered projects
- `/ward voice <voice>` → update `macos_voice` or `elevenlabs_voice_id`
- `/ward brain <provider> [model]` → update `brain_provider` / `brain_model`
- `/ward proactive <on|off|cooldown N|chat N>` → toggle and tune proactive knobs
- `/ward setup` → run `ensure_ward_home()` (replaces npm `ward-bootstrap`)
- `/ward doctor` → verify Ollama reachability, keys, and hook registration

All subcommands write to `~/.ward/config.json` through the existing `state_store.py` helpers.

### Step 6: First-Run Bootstrap From Inside Hooks

Modify `hooks/*.py` to call a shared `ensure_ward_home(force=False)` at the top of `main()`. This is a no-op after first run. It replaces the npm `postinstall` seeding and means the user does not have to remember `/ward setup`. The seed is still idempotent.

### Step 7: Retire Or Demote npm

Decide between two options and implement the chosen one:

- **Option A (recommended): remove.** Delete `package.json`, `scripts/postinstall.js`, `scripts/ward-init.js`. Update docs.
- **Option B: demote.** Keep the files, but move them under `legacy/` and mark them clearly as a fallback for non-Claude-Code environments.

### Step 8: Documentation Realignment

- `README.md`: replace the install section with the plugin-native flow. Remove `npm install -g` as primary. Keep Ollama setup, voice setup, and project registration.
- `WARD_SPEC.md`: update section 4.5 First-Time Install Flow to match. Remove any outdated `claude plugin install github.com/eljun/ward` lines and replace with the marketplace-of-one flow.
- `CHANGELOG.md`: add a `[2.0.0]` entry describing the distribution change as a breaking install-path change. Existing users will need to uninstall the npm package and re-install via the plugin system.

### Step 9: Clean-Install Verification

On a fresh user profile (or a disposable VM/container):
1. Ensure Ollama is running with `gemma4:e4b`.
2. From inside Claude Code, run `/plugin marketplace add eljun/ward` and `/plugin install ward@ward-plugins`.
3. Confirm `~/.ward/` is seeded after the first hook fires (or after `/ward setup`).
4. Open a project, run `/ward-init` (or `/ward register` if renamed), `/recap`, make a small conversational turn, confirm Ward speaks on a `conversation_turn`.
5. Trigger a deliberate tool error; confirm Ward reacts.
6. End the session; confirm the session-end summary saves.

## Acceptance Criteria

### Happy path
- [ ] Given a machine with only Claude Code, Python 3.9+, and Ollama, when the user runs `/plugin marketplace add eljun/ward` followed by `/plugin install ward@ward-plugins`, then WARD installs at user scope with no sudo and no npm.
- [ ] Given WARD is installed via the plugin system, when the user starts a new Claude Code session, then `SessionStart`, `Stop`, `PostToolUseFailure`, and `SessionEnd` hooks fire without any manual `~/.claude/settings.json` edit.
- [ ] Given a registered project, when the user runs `/ward status`, then the spoken output plus printed summary reflects the active brain, TTS provider, voice, and proactive knobs.
- [ ] Given WARD is installed, when the user runs `/ward voice Zoe`, then `~/.ward/config.json` updates and the next Ward line uses that voice.
- [ ] Given a clean `~/`, when the first hook fires, then `~/.ward/` and its seed files are created automatically.

### Error states
- [ ] Given the plugin install runs on a host where `python3` is missing, when a hook fires, then WARD fails toward silence with a clear stderr line and does not crash Claude Code.
- [ ] Given `~/.ward/config.json` is malformed, when `/ward status` runs, then the command reports the parse error and suggests `/ward setup --force`.

### Edge cases
- [ ] Reinstalling the plugin does not wipe the user's `~/.ward/config.json`, `persona.txt`, or per-project state files.
- [ ] An existing npm install of `ward-claude` can coexist with the plugin install without double-firing hooks. If collision is detected, the plugin prints a one-time warning recommending the npm removal.
- [ ] `${CLAUDE_PLUGIN_ROOT}` expansion works across macOS and Linux. Windows is out of scope for this task.

### Test setup
- **URL:** N/A
- **Test credentials:** N/A
- **Setup required:** Claude Code `>=2.1.0`, Python 3.9+, Ollama with `gemma4:e4b`, a clean user home for verification

## Dependencies

- Required packages: None new (reuses `brain.py`, `speak.py`, `state_store.py`, `bootstrap.py`).
- Required APIs: Claude Code plugin + marketplace APIs as documented at https://code.claude.com/docs/en/plugins-reference.md and https://code.claude.com/docs/en/plugin-marketplaces.md.
- Blocked by: Verification of the exact manifest schema and `${CLAUDE_PLUGIN_ROOT}` behavior against a live Claude Code `>=2.1.0`.

## Notes for Implementation Agent

- Do not start by removing the npm path. First prove the plugin-native path end-to-end on a clean profile. Only then decide between deletion and demotion.
- Resist the urge to also migrate the buddy skill (Task 2) inside this refactor. Keep Task 2 as a follow-up that lands on top of the plugin-native foundation.
- Keep all hook scripts backwards-compatible with the current stdin payload shape. The plugin system should pass the same payloads as the legacy settings.json hook config.
- Preserve `~/.ward/` as the single source of truth for user configuration. The plugin install path must not move or fork that directory.
- When rewriting command files, confirm that `${CLAUDE_PLUGIN_ROOT}` resolves inside command bodies (markdown) the same way it does inside hook commands (manifest). If not, the `/ward` command may need to shell out through a small wrapper.
- Bump the plugin version to `2.0.0` and call it out in `CHANGELOG.md` as a breaking install-path change. Existing npm users should be told to `npm uninstall -g ward-claude` before installing via the plugin system.

## Related

- Companion task (buddy gate + persona): already shipped on `claude/proactive-buddy-behavior-4vLS6`.
- Follow-up task: [002-ward-buddy-skill.md](002-ward-buddy-skill.md). Will land on top of the plugin-native foundation delivered here.
- Sibling task: [001-codex-session-subscription-adapter.md](001-codex-session-subscription-adapter.md). Independent of this refactor but benefits from the same plugin-native scaffolding.
- Spec: [WARD_SPEC.md](/Users/eleazarjunsan/Code/Personal/ward/WARD_SPEC.md)
- Setup and positioning: [README.md](/Users/eleazarjunsan/Code/Personal/ward/README.md)
