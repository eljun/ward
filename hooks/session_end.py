#!/usr/bin/env python3
"""
session_end.py — SessionEnd hook for WARD.

Reads the session transcript, sends it to brain.py to generate an updated
state.json, writes the result, and speaks a brief wrap-up.

Hook payload (stdin):
  {
    "hook_event_name": "SessionEnd",
    "session_id": "...",
    "transcript_path": "/path/to/transcript.jsonl",
    "cwd": "/path/to/project",
    "reason": "clear|resume|logout|prompt_input_exit|bypass_permissions_disabled|other"
  }
"""

import json
import os
import sys
from datetime import date

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(HOOKS_DIR)
SCRIPTS_DIR = os.path.join(REPO_DIR, "scripts")
sys.path.insert(0, SCRIPTS_DIR)

WARD_DIR = os.path.expanduser("~/.ward")
STATE_PATH = os.path.join(WARD_DIR, "state.json")
CONFIG_PATH = os.path.join(WARD_DIR, "config.json")

# Max transcript lines to send — keep costs low
MAX_TRANSCRIPT_LINES = 60


def load_json(path: str) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def read_transcript(path: str) -> list[dict]:
    """Read last N lines from the JSONL transcript."""
    if not path or not os.path.exists(path):
        return []
    lines = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        lines.append(json.loads(line))
                    except Exception:
                        pass
    except Exception:
        pass
    return lines[-MAX_TRANSCRIPT_LINES:]


def write_state(state: dict) -> None:
    os.makedirs(WARD_DIR, exist_ok=True)
    with open(STATE_PATH, "w") as f:
        json.dump(state, f, indent=2)


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}

    transcript_path = payload.get("transcript_path", "")
    cwd = payload.get("cwd", os.getcwd())

    current_state = load_json(STATE_PATH)
    config = load_json(CONFIG_PATH)

    # Enrich state with project info from config if available
    projects = config.get("projects", {})
    project_config = projects.get(cwd, {})
    if project_config.get("project_name"):
        current_state["project"] = project_config["project_name"]
    if project_config.get("tasks_md_path"):
        tasks_abs = os.path.join(cwd, project_config["tasks_md_path"])
        current_state["tasks_md_path"] = tasks_abs

    transcript_events = read_transcript(transcript_path)

    from brain import run as brain_run
    from speak import speak

    context = {
        "transcript_events": transcript_events,
        "previous_state": current_state,
        "cwd": cwd,
    }

    # Ask brain to return updated state JSON
    raw_state = brain_run(event="session_end", context=context, mode="state")

    # Parse and merge — never overwrite with garbage
    try:
        new_state = json.loads(raw_state)
        if isinstance(new_state, dict):
            merged = {**current_state, **new_state, "last_active": date.today().isoformat()}
            write_state(merged)
    except Exception as e:
        print(f"[ward] Could not parse state update from brain: {e}", file=sys.stderr)
        # Still stamp last_active so session_start knows we ran today
        current_state["last_active"] = date.today().isoformat()
        write_state(current_state)

    speak("Alright, wrapping up. I've saved your session summary.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[ward] session_end error: {e}", file=sys.stderr)
        sys.exit(0)
