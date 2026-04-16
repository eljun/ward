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

# Max transcript lines to send — keep costs low
MAX_TRANSCRIPT_LINES = 60


def read_transcript(path: str) -> list[dict]:
    """Extract a slim conversation summary from the transcript.

    Raw JSONL entries contain full tool inputs/outputs and can exceed 100K chars,
    which causes Ollama to choke and return prose instead of JSON. Instead we
    extract only actual human messages and final assistant text responses,
    keeping the payload small enough for a local model to handle reliably.
    """
    if not path or not os.path.exists(path):
        return []

    raw = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        raw.append(json.loads(line))
                    except Exception:
                        pass
    except Exception:
        pass

    slim = []
    for entry in raw[-MAX_TRANSCRIPT_LINES * 4:]:
        entry_type = entry.get("type", "")
        msg = entry.get("message", {}) if isinstance(entry.get("message"), dict) else {}
        content = msg.get("content", entry.get("content", []))

        if entry_type == "user":
            # Skip tool result callbacks — keep only real human messages
            if isinstance(content, list):
                if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
                    continue
                text = " ".join(
                    b.get("text", "") for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                ).strip()
            elif isinstance(content, str):
                text = content.strip()
            else:
                continue
            if text:
                slim.append({"role": "user", "text": text[:500]})

        elif entry_type == "assistant":
            # Keep only text blocks, skip tool_use and thinking blocks
            if isinstance(content, list):
                text = " ".join(
                    b.get("text", "") for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                ).strip()
            elif isinstance(content, str):
                text = content.strip()
            else:
                text = ""
            if text:
                slim.append({"role": "assistant", "text": text[:800]})

    return slim[-MAX_TRANSCRIPT_LINES:]
def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}

    transcript_path = payload.get("transcript_path", "")
    cwd = payload.get("cwd", os.getcwd())

    from bootstrap import ensure_ward_home_silent
    from state_store import find_project_config, load_config, load_state, merge_state, write_state

    ensure_ward_home_silent()
    config = load_config()
    state_path, current_state = load_state(cwd, config)

    # Enrich state with project info from config if available
    project_root, project_config = find_project_config(cwd, config)
    if project_config.get("project_name"):
        current_state["project"] = project_config["project_name"]
    if project_config.get("tasks_md_path"):
        tasks_base = project_root or cwd
        tasks_abs = os.path.join(tasks_base, project_config["tasks_md_path"])
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
            merged = merge_state(current_state, {**new_state, "last_active": date.today().isoformat()})
            write_state(state_path, merged)
    except Exception as e:
        print(f"[ward] Could not parse state update from brain: {e}", file=sys.stderr)
        # Still stamp last_active so session_start knows we ran today
        current_state["last_active"] = date.today().isoformat()
        write_state(state_path, current_state)

    speak("Alright, wrapping up. I've saved your session summary.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[ward] session_end error: {e}", file=sys.stderr)
        sys.exit(0)
