#!/usr/bin/env python3
"""
post_response.py — Stop hook for WARD.

Fires after each complete Claude response. Reads the last transcript entries,
asks brain if there's anything worth saying. Speaks only if notable.
Silent on routine reads, simple edits, status checks.

Hook payload (stdin):
  {
    "hook_event_name": "Stop",
    "session_id": "...",
    "transcript_path": "/path/to/transcript.jsonl",
    "cwd": "/path/to/project"
  }
"""

import json
import os
import sys

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(HOOKS_DIR)
SCRIPTS_DIR = os.path.join(REPO_DIR, "scripts")
sys.path.insert(0, SCRIPTS_DIR)

WARD_DIR = os.path.expanduser("~/.ward")
CONFIG_PATH = os.path.join(WARD_DIR, "config.json")

# How many recent transcript lines to send brain
MAX_LINES = 30


def load_json(path: str) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def read_recent_transcript(path: str) -> list[dict]:
    """Read last N entries from transcript JSONL."""
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
    return lines[-MAX_LINES:]


def summarize_transcript(entries: list[dict]) -> list[dict]:
    """Extract tool calls and results into a compact summary for brain."""
    summary = []
    for entry in entries:
        role = entry.get("role", "")
        content = entry.get("content", [])

        if isinstance(content, str):
            # Plain text message
            if role == "assistant":
                summary.append({"role": "assistant", "text": content[:200]})
            continue

        for block in content:
            btype = block.get("type", "")
            if btype == "tool_use":
                tool = block.get("name", "")
                inp = block.get("input", {})
                # Summarize input — keep it short
                brief_input = {}
                if "command" in inp:
                    brief_input["command"] = inp["command"][:100]
                if "file_path" in inp:
                    brief_input["file_path"] = inp["file_path"]
                if "description" in inp:
                    brief_input["description"] = inp["description"][:100]
                summary.append({"tool": tool, "input": brief_input})

            elif btype == "tool_result":
                result_content = block.get("content", "")
                if isinstance(result_content, list):
                    result_content = " ".join(
                        b.get("text", "") for b in result_content if isinstance(b, dict)
                    )
                summary.append({
                    "tool_result": str(result_content)[:150]
                })

            elif btype == "text" and role == "assistant":
                text = block.get("text", "").strip()
                if text:
                    summary.append({"assistant_text": text[:200]})

    return summary


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}

    transcript_path = payload.get("transcript_path", "")
    cwd = payload.get("cwd", os.getcwd())

    config = load_json(CONFIG_PATH)
    projects = config.get("projects", {})
    project_config = projects.get(cwd, {})
    project_name = project_config.get("project_name", "")

    entries = read_recent_transcript(transcript_path)
    if not entries:
        return

    summary = summarize_transcript(entries)
    if not summary:
        return

    from brain import run as brain_run
    from speak import speak

    context = {
        "recent_actions": summary,
        "project": project_name,
        "cwd": cwd,
    }

    speech = brain_run(event="post_response", context=context, mode="speak")

    # Only speak if brain returned actual content
    if speech and speech.strip():
        speak(speech)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[ward] post_response error: {e}", file=sys.stderr)
        sys.exit(0)
