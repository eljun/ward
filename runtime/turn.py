"""
turn.py — roll normalized events into a single turn view.

The Claude hook path used to do this from a raw transcript file. The Codex
adapter builds it from a live stream of TurnEvent objects. Both paths now
converge on the same turn shape so `gating.gate_turn` and `brain.run` receive
identical inputs.
"""

import hashlib
import json
from typing import Iterable


INTERESTING_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "shell", "apply_patch"}
RISKY_KEYWORDS = (
    "migration",
    "migrate",
    "schema",
    "drop ",
    "truncate ",
    "delete from",
    "rm ",
    "reset --hard",
    "force push",
    "chmod",
    "sudo",
)
COMPLETION_KEYWORDS = (
    "implemented",
    "fixed",
    "resolved",
    "refactored",
    "wired up",
    "updated",
    "added",
    "created",
    "shipped",
    "passed",
)


def turn_signature(user_text: str, assistant_text: str, tools: list) -> str:
    payload = json.dumps(
        {
            "user_text": user_text[:400],
            "assistant_text": assistant_text[:1000],
            "tools": tools,
        },
        sort_keys=True,
    )
    return hashlib.sha1(payload.encode()).hexdigest()


def build_turn_from_events(events: Iterable) -> dict:
    """Fold a sequence of TurnEvent objects into the turn view consumed by the gate.

    Accepts either TurnEvent dataclasses or plain dicts with the same fields so
    both adapters can feed this without importing the dataclass.
    """
    user_text_parts = []
    assistant_text_parts = []
    tools = []
    tool_results = []
    files_touched = set()

    for event in events:
        event_dict = event.to_dict() if hasattr(event, "to_dict") else dict(event)
        event_type = event_dict.get("type", "")
        content = event_dict.get("content", "") or ""

        if event_type == "user_message" and content:
            user_text_parts.append(str(content).strip())
        elif event_type == "assistant_message_completed" and content:
            assistant_text_parts.append(str(content).strip())
        elif event_type == "tool_call":
            brief = _tool_brief(event_dict)
            tools.append(brief)
            if brief.get("file_path"):
                files_touched.add(brief["file_path"])
        elif event_type == "tool_result" and content:
            tool_results.append(str(content)[:300])

    user_text = "\n".join(part for part in user_text_parts if part).strip()
    assistant_text = "\n".join(part for part in assistant_text_parts if part).strip()

    return {
        "user_text": user_text,
        "assistant_text": assistant_text,
        "assistant_excerpt": assistant_text[:500],
        "assistant_chars": len(assistant_text),
        "tools": tools,
        "tool_results": tool_results[:6],
        "files_touched": sorted(files_touched),
        "signature": turn_signature(user_text, assistant_text, tools),
    }


def _tool_brief(event_dict: dict) -> dict:
    tool_input = event_dict.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        tool_input = {}
    return {
        "tool": event_dict.get("tool_name", ""),
        "file_path": (
            tool_input.get("file_path")
            or tool_input.get("path")
            or tool_input.get("filePath")
            or ""
        ),
        "command": (tool_input.get("command") or "")[:180],
        "description": (tool_input.get("description") or "")[:180],
    }
