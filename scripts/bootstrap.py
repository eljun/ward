#!/usr/bin/env python3
"""
bootstrap.py — initialize WARD's global home directory.

Creates ~/.ward and seeds config/persona/state from the repo templates if they
do not already exist. Existing files are preserved unless --force is used.

From v2.0.0 onward WARD is distributed as a Claude Code plugin. The plugin
system delivers slash commands directly from this repo's commands/ directory,
so bootstrap.py no longer copies them into ~/.claude/commands/. Legacy npm
installs may still call install_commands() explicitly.
"""

import os
import shutil
import sys

from ward_paths import ward_home

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
WARD_HOME = ward_home()
CLAUDE_COMMANDS_DIR = os.path.expanduser("~/.claude/commands")

SEED_FILES = (
    ("config.json", "config.json"),
    ("persona.txt", "persona.txt"),
    ("state.json", "state.json"),
)

COMMAND_FILES = (
    "recap.md",
    "summary.md",
    "ward-init.md",
    "ward.md",
)


def copy_seed(src_name: str, dest_name: str, force: bool) -> str:
    src_path = os.path.join(REPO_DIR, src_name)
    dest_path = os.path.join(WARD_HOME, dest_name)
    if not os.path.exists(src_path):
        return f"missing template: {src_name}"
    if os.path.exists(dest_path) and not force:
        return f"kept existing: {dest_path}"
    shutil.copyfile(src_path, dest_path)
    return f"wrote: {dest_path}"


def install_commands() -> list:
    """Legacy: copy slash commands into ~/.claude/commands/.

    Only used by the npm fallback install. The plugin install path delivers
    commands directly from this repo, with ${CLAUDE_PLUGIN_ROOT} resolved at
    runtime — no file copying required.
    """
    os.makedirs(CLAUDE_COMMANDS_DIR, exist_ok=True)
    messages = []
    for name in COMMAND_FILES:
        src = os.path.join(REPO_DIR, "commands", name)
        dest = os.path.join(CLAUDE_COMMANDS_DIR, name)
        if not os.path.exists(src):
            messages.append(f"missing command template: {name}")
            continue
        with open(src) as f:
            content = f.read()
        # Legacy path: command files now reference ${CLAUDE_PLUGIN_ROOT}, which
        # is not defined outside the plugin system. Rewrite to the absolute
        # repo path so the slash commands still work under the npm fallback.
        content = content.replace("${CLAUDE_PLUGIN_ROOT}", REPO_DIR)
        with open(dest, "w") as f:
            f.write(content)
        messages.append(f"installed command (legacy): {dest}")
    return messages


def ensure_ward_home(force: bool = False) -> list:
    os.makedirs(WARD_HOME, exist_ok=True)
    os.makedirs(os.path.join(WARD_HOME, "states"), exist_ok=True)

    messages = []
    for src_name, dest_name in SEED_FILES:
        messages.append(copy_seed(src_name, dest_name, force))

    messages.append(f"WARD home ready: {WARD_HOME}")
    return messages


def ensure_ward_home_silent() -> None:
    """First-run bootstrap for plugin hooks.

    Creates ~/.ward/ and seeds config/persona/state the first time a hook
    fires. After the first run, every step is a no-op so hooks add negligible
    overhead. Exceptions are swallowed: a seed failure must not crash the
    hook path.
    """
    try:
        os.makedirs(WARD_HOME, exist_ok=True)
        os.makedirs(os.path.join(WARD_HOME, "states"), exist_ok=True)
        for src_name, dest_name in SEED_FILES:
            src_path = os.path.join(REPO_DIR, src_name)
            dest_path = os.path.join(WARD_HOME, dest_name)
            if os.path.exists(dest_path) or not os.path.exists(src_path):
                continue
            shutil.copyfile(src_path, dest_path)
    except Exception:
        pass


def main() -> int:
    force = "--force" in sys.argv[1:]
    legacy = "--legacy-commands" in sys.argv[1:]

    for message in ensure_ward_home(force=force):
        print(message)
    if legacy:
        for message in install_commands():
            print(message)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
