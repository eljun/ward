# Legacy npm install path

**This is the fallback path.** The recommended way to install WARD is the Claude Code plugin, which needs no `sudo`, no `npm`, and no manual `~/.claude/settings.json` edits:

```
/plugin marketplace add eljun/ward
/plugin install ward@ward-plugins
```

Use this npm package only when you cannot use the plugin system (for example, running Claude Code in an environment where `/plugin install` is unavailable).

## Install

Global install requires write access to the npm prefix. If your npm prefix is system-owned, this will fail without `sudo`; the standard workaround is to reconfigure npm to use a user-owned prefix.

```bash
# From a cloned repo
cd ward/legacy/npm
npm install -g .
ward-bootstrap            # seeds ~/.ward/ and installs legacy slash commands into ~/.claude/commands/
ward-init                 # register the current project
```

## What this does differently from the plugin install

The npm path cannot rely on `${CLAUDE_PLUGIN_ROOT}`, so `postinstall.js` runs `scripts/bootstrap.py --legacy-commands`. That:
- seeds `~/.ward/` (same as the plugin path), and
- copies the slash command markdown files into `~/.claude/commands/`, rewriting `${CLAUDE_PLUGIN_ROOT}` to the absolute npm install path so commands still resolve.

Hooks still need to be wired by hand under this path. Either run the plugin install alongside, or add the four hook scripts to your `~/.claude/settings.json` manually.

## When to migrate

As soon as your Claude Code version supports `/plugin install`, migrate to the plugin path:

```
npm uninstall -g ward-claude
# Then inside Claude Code:
/plugin marketplace add eljun/ward
/plugin install ward@ward-plugins
```
