#!/usr/bin/env python3
"""
bootstrap.py — initialize WARD's global home directory.

Creates ~/.ward and seeds config/persona/state from the repo templates if they
do not already exist. Also installs ward slash commands into ~/.claude/commands/
so they are available in every project.

Existing files are preserved unless --force is used.
"""

import os
import shutil
import sys


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
WARD_HOME = os.path.expanduser("~/.ward")
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


def install_commands() -> list[str]:
    os.makedirs(CLAUDE_COMMANDS_DIR, exist_ok=True)
    messages = []
    for name in COMMAND_FILES:
        src = os.path.join(REPO_DIR, "commands", name)
        dest = os.path.join(CLAUDE_COMMANDS_DIR, name)
        if not os.path.exists(src):
            messages.append(f"missing command template: {name}")
            continue
        # Commands are always overwritten — they're not user-edited files.
        # Substitute {ward_repo} with the actual install path so commands
        # work from any project, not just the ward repo itself.
        with open(src) as f:
            content = f.read()
        content = content.replace("{ward_repo}", REPO_DIR)
        with open(dest, "w") as f:
            f.write(content)
        messages.append(f"installed command: {dest}")
    return messages


def ensure_ward_home(force: bool = False) -> list[str]:
    os.makedirs(WARD_HOME, exist_ok=True)
    os.makedirs(os.path.join(WARD_HOME, "states"), exist_ok=True)

    messages = []
    for src_name, dest_name in SEED_FILES:
        messages.append(copy_seed(src_name, dest_name, force))

    messages += install_commands()
    messages.append(f"WARD home ready: {WARD_HOME}")
    return messages


def main() -> int:
    force = "--force" in sys.argv[1:]

    for message in ensure_ward_home(force=force):
        print(message)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
