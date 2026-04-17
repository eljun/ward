"""
session_events.py — provider-agnostic event helpers for WARD session adapters.
"""

from __future__ import annotations

from datetime import datetime, timezone


SESSION_EVENT_KINDS = {
    "assistant_message_completed",
    "assistant_message_delta",
    "prompt_submitted",
    "session_ended",
    "session_resumed",
    "session_started",
    "tool_call",
    "tool_result",
    "turn_completed",
    "turn_started",
    "user_message",
}


def make_session_event(kind: str, **fields) -> dict:
    if kind not in SESSION_EVENT_KINDS:
        raise ValueError(f"Unsupported session event kind: {kind}")

    event = {
        "kind": kind,
        "provider": fields.pop("provider", ""),
        "source": fields.pop("source", ""),
        "session_id": fields.pop("session_id", ""),
        "thread_id": fields.pop("thread_id", ""),
        "turn_id": fields.pop("turn_id", ""),
        "message_id": fields.pop("message_id", ""),
        "tool_name": fields.pop("tool_name", ""),
        "content": fields.pop("content", ""),
        "cwd": fields.pop("cwd", ""),
        "project_name": fields.pop("project_name", ""),
        "timestamp": fields.pop("timestamp", _utc_now()),
        "files_touched": list(fields.pop("files_touched", []) or []),
        "tool_input": fields.pop("tool_input", {}),
        "tool_output": fields.pop("tool_output", ""),
        "status": fields.pop("status", ""),
        "raw_event": fields.pop("raw_event", {}),
    }
    event.update(fields)
    return event


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
