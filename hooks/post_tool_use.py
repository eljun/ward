#!/usr/bin/env python3
"""
post_tool_use.py — PostToolUseFailure hook for WARD.

Fires only when a tool call fails. Extracts tool_name and tool_error,
sends to brain.py, speaks the result. Deduplicates repeated identical errors.

Hook payload (stdin):
  {
    "hook_event_name": "PostToolUseFailure",
    "session_id": "...",
    "tool_name": "Bash|Write|Edit|Read|...",
    "tool_input": {},
    "tool_error": "error message string",
    "tool_use_id": "toolu_01..."
  }
"""

import json
import os
import sys
import tempfile

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(HOOKS_DIR)
SCRIPTS_DIR = os.path.join(REPO_DIR, "scripts")
sys.path.insert(0, SCRIPTS_DIR)

# Temp file used to track last error for deduplication (per OS session)
LAST_ERROR_PATH = os.path.join(tempfile.gettempdir(), "ward_last_error.json")


def load_last_error() -> dict:
    try:
        with open(LAST_ERROR_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


def save_last_error(tool_name: str, tool_error: str) -> None:
    try:
        with open(LAST_ERROR_PATH, "w") as f:
            json.dump({"tool_name": tool_name, "tool_error": tool_error}, f)
    except Exception:
        pass


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return

    tool_name = payload.get("tool_name", "unknown")
    tool_error = payload.get("tool_error", "")

    if not tool_error:
        return

    # Silence threshold: skip if exact same error as last time
    last = load_last_error()
    if last.get("tool_name") == tool_name and last.get("tool_error") == tool_error:
        return

    save_last_error(tool_name, tool_error)

    from bootstrap import ensure_ward_home_silent
    from brain import run as brain_run
    from speak import speak

    ensure_ward_home_silent()

    context = {
        "tool_name": tool_name,
        "tool_error": tool_error,
    }

    speech = brain_run(event="tool_error", context=context, mode="speak")
    speak(speech)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[ward] post_tool_use error: {e}", file=sys.stderr)
        sys.exit(0)
