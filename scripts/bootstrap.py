#!/usr/bin/env python3
"""
bootstrap.py — initialize WARD's global home directory.

Creates ~/.ward and seeds config/persona/state from the repo templates if they
do not already exist. Existing files are preserved unless --force is used.
"""

import os
import shutil
import sys


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
WARD_HOME = os.path.expanduser("~/.ward")

SEED_FILES = (
    ("config.json", "config.json"),
    ("persona.txt", "persona.txt"),
    ("state.json", "state.json"),
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


def main() -> int:
    force = "--force" in sys.argv[1:]

    os.makedirs(WARD_HOME, exist_ok=True)
    os.makedirs(os.path.join(WARD_HOME, "states"), exist_ok=True)

    for src_name, dest_name in SEED_FILES:
        print(copy_seed(src_name, dest_name, force))

    print(f"WARD home ready: {WARD_HOME}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
