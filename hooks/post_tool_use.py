#!/usr/bin/env python3
"""
post_tool_use.py — PostToolUse hook for WARD.

Thin Claude hook entrypoint: normalize the hook payload into a shared session
event, then let the shared runtime decide whether the tool result warrants
speech. Current behavior remains failure-focused.
"""

from __future__ import annotations

import json
import os
import sys


HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(HOOKS_DIR)
SCRIPTS_DIR = os.path.join(REPO_DIR, "scripts")
sys.path.insert(0, SCRIPTS_DIR)


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}

    from bootstrap import ensure_ward_home_silent
    from claude_adapter import normalize_claude_hook_payload
    from session_runtime import handle_event

    ensure_ward_home_silent()
    for event in normalize_claude_hook_payload(payload):
        handle_event(event, output_mode="speak")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ward] post_tool_use error: {exc}", file=sys.stderr)
        sys.exit(0)
