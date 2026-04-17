"""
claude_adapter.py — normalize Claude hook payloads into WARD session events.
"""

from __future__ import annotations

import hashlib
import json
import os

from session_events import make_session_event

MAX_STOP_TRANSCRIPT_LINES = 200
MAX_SESSION_END_TRANSCRIPT_LINES = 60


def normalize_claude_hook_payload(payload: dict) -> list[dict]:
    if not isinstance(payload, dict):
        return []

    hook_event_name = str(payload.get("hook_event_name", "")).strip()
    common = {
        "provider": "claude_code",
        "source": "claude_hooks",
        "session_id": str(payload.get("session_id", "")).strip(),
        "cwd": str(payload.get("cwd", "")).strip(),
        "raw_event": payload,
    }

    if hook_event_name == "SessionStart":
        source = str(payload.get("source", "")).strip().lower()
        kind = "session_resumed" if source in {"resume", "clear", "compact"} else "session_started"
        return [
            make_session_event(
                kind,
                **common,
                content=source,
                transcript_path=str(payload.get("transcript_path", "")).strip(),
            )
        ]

    if hook_event_name == "Stop":
        transcript_path = str(payload.get("transcript_path", "")).strip()
        turn = collect_latest_turn(read_recent_transcript(transcript_path))
        if not turn:
            return []
        return [
            make_session_event(
                "turn_completed",
                **common,
                content=turn.get("assistant_text", ""),
                transcript_path=transcript_path,
                turn=turn,
            )
        ]

    if hook_event_name in {"PostToolUse", "PostToolUseFailure"}:
        tool_error = str(payload.get("tool_error", "")).strip()
        if not tool_error:
            return []
        return [
            make_session_event(
                "tool_result",
                **common,
                tool_name=str(payload.get("tool_name", "")).strip(),
                message_id=str(payload.get("tool_use_id", "")).strip(),
                content=tool_error,
                tool_output=tool_error,
                tool_input=payload.get("tool_input", {}) if isinstance(payload.get("tool_input"), dict) else {},
                status="failed",
            )
        ]

    if hook_event_name == "SessionEnd":
        transcript_path = str(payload.get("transcript_path", "")).strip()
        return [
            make_session_event(
                "session_ended",
                **common,
                content=str(payload.get("reason", "")).strip(),
                transcript_path=transcript_path,
                transcript_events=read_session_end_transcript(transcript_path),
            )
        ]

    if hook_event_name == "UserPromptSubmit":
        prompt = extract_user_prompt(payload)
        if not prompt:
            return []
        return [
            make_session_event(
                "prompt_submitted",
                **common,
                content=prompt,
                transcript_path=str(payload.get("transcript_path", "")).strip(),
            )
        ]

    return []


def read_recent_transcript(path: str) -> list[dict]:
    return _read_jsonl(path, limit=MAX_STOP_TRANSCRIPT_LINES)


def read_session_end_transcript(path: str) -> list[dict]:
    if not path or not os.path.exists(path):
        return []

    raw = _read_jsonl(path, limit=MAX_SESSION_END_TRANSCRIPT_LINES * 4)
    slim = []
    for entry in raw:
        entry_type = entry.get("type", "")
        msg = entry.get("message", {}) if isinstance(entry.get("message"), dict) else {}
        content = msg.get("content", entry.get("content", []))

        if entry_type == "user":
            if isinstance(content, list):
                if any(isinstance(block, dict) and block.get("type") == "tool_result" for block in content):
                    continue
                text = " ".join(
                    block.get("text", "")
                    for block in content
                    if isinstance(block, dict) and block.get("type") == "text"
                ).strip()
            elif isinstance(content, str):
                text = content.strip()
            else:
                continue
            if text:
                slim.append({"role": "user", "text": text[:500]})

        elif entry_type == "assistant":
            if isinstance(content, list):
                text = " ".join(
                    block.get("text", "")
                    for block in content
                    if isinstance(block, dict) and block.get("type") == "text"
                ).strip()
            elif isinstance(content, str):
                text = content.strip()
            else:
                text = ""
            if text:
                slim.append({"role": "assistant", "text": text[:800]})

    return slim[-MAX_SESSION_END_TRANSCRIPT_LINES:]


def collect_latest_turn(entries: list[dict]) -> dict:
    assistant_index = None
    for idx in range(len(entries) - 1, -1, -1):
        if _entry_role(entries[idx]) == "assistant":
            assistant_index = idx
            break
    if assistant_index is None:
        return {}

    human_index = None
    for idx in range(assistant_index - 1, -1, -1):
        if _is_human_turn(entries[idx]):
            human_index = idx
            break

    start = human_index if human_index is not None else assistant_index
    window = entries[start : assistant_index + 1]

    user_text = ""
    assistant_text_parts = []
    tools = []
    tool_results = []
    files_touched = set()

    for entry in window:
        role = _entry_role(entry)
        if _is_human_turn(entry) and not user_text:
            user_text = _entry_text(entry)

        for block in _entry_blocks(entry):
            block_type = block.get("type", "")
            if role == "assistant" and block_type == "text":
                text = block.get("text", "").strip()
                if text:
                    assistant_text_parts.append(text)
            elif block_type == "tool_use":
                brief = _tool_brief(block)
                tools.append(brief)
                if brief["file_path"]:
                    files_touched.add(brief["file_path"])
            elif block_type == "tool_result":
                content = _flatten_text(block.get("content", ""))
                if content:
                    tool_results.append(content[:300])

    assistant_text = "\n".join(part for part in assistant_text_parts if part).strip()
    signature_source = json.dumps(
        {
            "user_text": user_text[:400],
            "assistant_text": assistant_text[:1000],
            "tools": tools,
        },
        sort_keys=True,
    )
    return {
        "user_text": user_text,
        "assistant_text": assistant_text,
        "assistant_excerpt": assistant_text[:500],
        "assistant_chars": len(assistant_text),
        "tools": tools,
        "tool_results": tool_results[:6],
        "files_touched": sorted(files_touched),
        "signature": hashlib.sha1(signature_source.encode()).hexdigest(),
    }


def extract_user_prompt(payload: dict) -> str:
    candidates = (
        payload.get("user_prompt"),
        payload.get("prompt"),
        payload.get("input"),
        payload.get("text"),
    )
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return ""


def _read_jsonl(path: str, *, limit: int) -> list[dict]:
    if not path or not os.path.exists(path):
        return []
    lines = []
    try:
        with open(path) as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    lines.append(json.loads(line))
                except Exception:
                    pass
    except Exception:
        return []
    if limit <= 0:
        return lines
    return lines[-limit:]


def _flatten_text(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                text = item.get("text")
                if text:
                    parts.append(str(text))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return ""


def _entry_role(entry: dict) -> str:
    entry_type = entry.get("type", "")
    if entry_type in {"user", "assistant"}:
        return entry_type
    return entry.get("role", "") or entry.get("message", {}).get("role", "")


def _entry_blocks(entry: dict) -> list[dict]:
    msg = entry.get("message")
    if isinstance(msg, dict):
        content = msg.get("content", [])
    else:
        content = entry.get("content", [])
    if isinstance(content, list):
        return [block for block in content if isinstance(block, dict)]
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return []


def _is_human_turn(entry: dict) -> bool:
    if _entry_role(entry) != "user":
        return False
    return not any(block.get("type") == "tool_result" for block in _entry_blocks(entry))


def _entry_text(entry: dict) -> str:
    parts = []
    for block in _entry_blocks(entry):
        if block.get("type") == "text":
            text = block.get("text", "").strip()
            if text:
                parts.append(text)
    return "\n".join(parts).strip()


def _tool_brief(block: dict) -> dict:
    tool_input = block.get("input", {}) if isinstance(block.get("input"), dict) else {}
    return {
        "tool": block.get("name", ""),
        "file_path": tool_input.get("file_path") or tool_input.get("path") or tool_input.get("filePath") or "",
        "command": (tool_input.get("command") or "")[:180],
        "description": (tool_input.get("description") or "")[:180],
    }
