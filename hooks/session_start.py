#!/usr/bin/env python3
"""
session_start.py — SessionStart hook for WARD.

Reads state.json and speaks a recap if last_active was a previous day.
Speaks a brief greeting if resuming same day. Silent on errors — never crash.

Hook payload (stdin):
  {
    "hook_event_name": "SessionStart",
    "session_id": "...",
    "cwd": "/path/to/project",
    "transcript_path": "...",
    "source": "startup|resume|clear|compact"
  }
"""

import json
import os
import sys
from datetime import date

# Resolve paths relative to this file's location
HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(HOOKS_DIR)
SCRIPTS_DIR = os.path.join(REPO_DIR, "scripts")
sys.path.insert(0, SCRIPTS_DIR)

WARD_DIR = os.path.expanduser("~/.ward")
CONFIG_PATH = os.path.join(WARD_DIR, "config.json")


def load_json(path: str) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def get_state_path(cwd: str, config: dict) -> str:
    """Return per-project state path, falling back to global state.json."""
    project_config = config.get("projects", {}).get(cwd, {})
    project_name = project_config.get("project_name", "")
    if project_name:
        safe_name = project_name.lower().replace(" ", "_").replace("-", "_")
        states_dir = os.path.join(WARD_DIR, "states")
        os.makedirs(states_dir, exist_ok=True)
        return os.path.join(states_dir, f"{safe_name}.json")
    return os.path.join(WARD_DIR, "state.json")


def main() -> None:
    # Read hook payload from stdin
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}

    cwd = payload.get("cwd", os.getcwd())
    config = load_json(CONFIG_PATH)
    state_path = get_state_path(cwd, config)
    state = load_json(state_path)

    # Import scripts after path setup
    from brain import run as brain_run
    from speak import speak

    today = date.today().isoformat()

    # No state yet
    if not state:
        speak("No session history yet. Run /recap to sync from your tasks file.")
        return

    # Look up project config
    projects = config.get("projects", {})
    project_config = projects.get(cwd, {})
    project_name = project_config.get("project_name") or state.get("project", "")

    last_active = state.get("last_active", "")

    context = {
        "last_active": last_active,
        "current_task": state.get("current_task", ""),
        "top_priorities": state.get("top_priorities", []),
        "pending_prs": state.get("pending_prs", []),
        "last_summary": state.get("last_summary", ""),
        "project": project_name,
    }

    if last_active == today:
        # Same-day resume — brief greeting only
        speech = brain_run(event="session_start_same_day", context=context, mode="speak")
    else:
        # New day — full recap
        speech = brain_run(event="session_start", context=context, mode="speak")

    speak(speech)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Fail toward silence — never surface a stack trace to the user
        print(f"[ward] session_start error: {e}", file=sys.stderr)
        sys.exit(0)
