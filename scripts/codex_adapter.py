"""
codex_adapter.py — normalize Codex app-server and exec events into WARD session events.
"""

from __future__ import annotations

import json

from session_events import make_session_event


def normalize_codex_payload(payload: dict, source: str = "auto") -> list[dict]:
    if not isinstance(payload, dict):
        return []

    if source in {"auto", "app-server"} and "method" in payload:
        return _normalize_app_server_message(payload)
    if source in {"auto", "exec-json"} and "type" in payload:
        return _normalize_exec_event(payload)
    return []


def _normalize_app_server_message(payload: dict) -> list[dict]:
    method = str(payload.get("method", "")).strip().lower()
    params = payload.get("params", {})
    if not isinstance(params, dict):
        return []

    common = {
        "provider": "codex",
        "source": "codex_app_server",
        "raw_event": payload,
    }
    if method == "thread/started":
        thread = params.get("thread", {})
        return [_thread_event("session_started", thread, common)]
    if method == "turn/started":
        turn = params.get("turn", {})
        return [
            make_session_event(
                "turn_started",
                **common,
                session_id=params.get("threadId", ""),
                thread_id=params.get("threadId", ""),
                turn_id=turn.get("id", ""),
                status=_turn_status(turn),
            )
        ]
    if method == "item/agentmessage/delta":
        return [
            make_session_event(
                "assistant_message_delta",
                **common,
                session_id=params.get("threadId", ""),
                thread_id=params.get("threadId", ""),
                turn_id=params.get("turnId", ""),
                message_id=params.get("itemId", ""),
                content=params.get("delta", ""),
            )
        ]
    if method == "item/completed":
        return _normalize_item_completed(
            params.get("item", {}),
            thread_id=params.get("threadId", ""),
            turn_id=params.get("turnId", ""),
            common=common,
        )
    if method == "turn/completed":
        turn = params.get("turn", {})
        return [
            make_session_event(
                "turn_completed",
                **common,
                session_id=params.get("threadId", ""),
                thread_id=params.get("threadId", ""),
                turn_id=turn.get("id", ""),
                status=_turn_status(turn),
                content=_turn_error_message(turn),
            )
        ]
    return []


def _normalize_exec_event(payload: dict) -> list[dict]:
    raw_event_type = str(payload.get("type", "")).strip().lower()
    event_type = raw_event_type.replace(".", "/")
    common = {
        "provider": "codex",
        "source": "codex_exec_json",
        "raw_event": payload,
    }

    if event_type == "thread/started":
        thread = payload.get("thread", payload)
        return [_thread_event("session_started", thread, common)]
    if event_type == "thread/resumed":
        thread = payload.get("thread", payload)
        return [_thread_event("session_resumed", thread, common)]
    if event_type == "turn/started":
        turn = payload.get("turn", payload)
        return [
            make_session_event(
                "turn_started",
                **common,
                session_id=_first_value(payload, "thread_id", "threadId"),
                thread_id=_first_value(payload, "thread_id", "threadId"),
                turn_id=_first_value(turn, "id", "turn_id", "turnId"),
                status=_turn_status(turn, fallback="started", prefer_type=False),
            )
        ]
    if event_type in {"item/agentmessage/delta", "agent/message/delta", "item/agent_message/delta"}:
        return [
            make_session_event(
                "assistant_message_delta",
                **common,
                session_id=_first_value(payload, "thread_id", "threadId"),
                thread_id=_first_value(payload, "thread_id", "threadId"),
                turn_id=_first_value(payload, "turn_id", "turnId"),
                message_id=_first_value(payload, "item_id", "itemId"),
                content=_first_value(payload, "delta", "text"),
            )
        ]
    if event_type == "item/completed":
        return _normalize_item_completed(
            payload.get("item", payload),
            thread_id=_first_value(payload, "thread_id", "threadId"),
            turn_id=_first_value(payload, "turn_id", "turnId"),
            common=common,
        )
    if event_type == "turn/completed":
        turn = payload.get("turn", payload)
        return [
            make_session_event(
                "turn_completed",
                **common,
                session_id=_first_value(payload, "thread_id", "threadId"),
                thread_id=_first_value(payload, "thread_id", "threadId"),
                turn_id=_first_value(turn, "id", "turn_id", "turnId"),
                status=_turn_status(turn, fallback="completed", prefer_type=False),
                content=_turn_error_message(turn),
            )
        ]
    if event_type == "session/ended":
        return [
            make_session_event(
                "session_ended",
                **common,
                session_id=_first_value(payload, "thread_id", "threadId", "session_id", "sessionId"),
                thread_id=_first_value(payload, "thread_id", "threadId"),
                content=_first_value(payload, "reason", "message"),
            )
        ]
    return []


def _thread_event(kind: str, thread: dict, common: dict) -> dict:
    thread = thread if isinstance(thread, dict) else {}
    return make_session_event(
        kind,
        **common,
        session_id=thread.get("id", "") or thread.get("thread_id", ""),
        thread_id=thread.get("id", "") or thread.get("thread_id", ""),
        cwd=thread.get("cwd", ""),
        status=_status_type(thread.get("status")),
    )


def _normalize_item_completed(item: dict, *, thread_id: str, turn_id: str, common: dict) -> list[dict]:
    item = item if isinstance(item, dict) else {}
    item_type = str(item.get("type", "")).strip()
    normalized_item_type = item_type.replace("_", "")
    item_id = str(item.get("id", "")).strip()
    base = {
        **common,
        "session_id": thread_id,
        "thread_id": thread_id,
        "turn_id": turn_id,
        "message_id": item_id,
    }

    if item_type in {"userMessage", "user_message"}:
        return [
            make_session_event(
                "user_message",
                **base,
                content=_extract_user_message_text(item.get("content", [])),
            )
        ]

    if item_type in {"agentMessage", "agent_message"}:
        return [
            make_session_event(
                "assistant_message_completed",
                **base,
                content=item.get("text", ""),
            )
        ]

    if item_type in {"commandExecution", "command_execution"}:
        output = item.get("aggregatedOutput") or item.get("aggregated_output") or ""
        return [
            make_session_event(
                "tool_result",
                **base,
                tool_name="Bash",
                content=str(output).strip(),
                tool_output=str(output).strip(),
                tool_input={"command": item.get("command", ""), "cwd": item.get("cwd", "") or item.get("working_dir", "")},
                files_touched=_command_paths(item),
                status=item.get("status", ""),
            )
        ]

    if item_type in {"fileChange", "file_change"}:
        touched = []
        for change in item.get("changes", []) or []:
            if isinstance(change, dict) and change.get("path"):
                touched.append(str(change["path"]))
        return [
            make_session_event(
                "tool_result",
                **base,
                tool_name="ApplyPatch",
                content=f"Updated {len(touched)} file(s)",
                files_touched=touched,
                status=item.get("status", ""),
            )
        ]

    if normalized_item_type == "mcpToolCall".replace("_", ""):
        return [
            make_session_event(
                "tool_result",
                **base,
                tool_name=item.get("tool", ""),
                content=_stringify(item.get("result")),
                tool_output=_stringify(item.get("result")),
                tool_input={"arguments": item.get("arguments", {}), "server": item.get("server", "")},
                status=item.get("status", ""),
            )
        ]

    if normalized_item_type == "dynamicToolCall".replace("_", ""):
        return [
            make_session_event(
                "tool_result",
                **base,
                tool_name=item.get("tool", ""),
                content=_dynamic_tool_content(item),
                tool_output=_dynamic_tool_content(item),
                tool_input={"arguments": item.get("arguments", {})},
                status=item.get("status", ""),
            )
        ]

    return []


def _extract_user_message_text(content: list) -> str:
    if not isinstance(content, list):
        return ""
    parts = []
    for item in content:
        if not isinstance(item, dict):
            continue
        item_type = item.get("type", "")
        if item_type == "text" and item.get("text"):
            parts.append(str(item["text"]).strip())
        elif item_type in {"localImage", "image"}:
            parts.append(f"[{item_type}]")
        elif item_type in {"skill", "mention"}:
            name = item.get("name") or item.get("path") or item_type
            parts.append(f"[{item_type}:{name}]")
    return "\n".join(part for part in parts if part).strip()


def _dynamic_tool_content(item: dict) -> str:
    content_items = item.get("contentItems", [])
    if not isinstance(content_items, list):
        return ""
    parts = []
    for content_item in content_items:
        if not isinstance(content_item, dict):
            continue
        if content_item.get("type") == "inputText" and content_item.get("text"):
            parts.append(str(content_item["text"]).strip())
        elif content_item.get("type") == "inputImage" and content_item.get("imageUrl"):
            parts.append(f"[image:{content_item['imageUrl']}]")
    return "\n".join(part for part in parts if part).strip()


def _command_paths(item: dict) -> list[str]:
    paths = []
    for action in item.get("commandActions", []) or []:
        if not isinstance(action, dict):
            continue
        path = action.get("path")
        if path:
            paths.append(str(path))
    return sorted(dict.fromkeys(paths))


def _first_value(payload: dict, *keys: str) -> str:
    for key in keys:
        value = payload.get(key)
        if value:
            return str(value)
    return ""


def _status_type(status: dict | str | None) -> str:
    if isinstance(status, dict):
        return str(status.get("type", "")).strip()
    return str(status or "").strip()


def _turn_status(turn: dict, fallback: str = "", prefer_type: bool = True) -> str:
    if not isinstance(turn, dict):
        return fallback
    if prefer_type:
        return str(turn.get("status", "") or turn.get("type", "") or fallback).strip()
    return str(turn.get("status", "") or fallback).strip()


def _turn_error_message(turn: dict) -> str:
    error = (turn or {}).get("error")
    if isinstance(error, dict):
        return str(error.get("message", "")).strip()
    return ""


def _stringify(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    try:
        return json.dumps(value, sort_keys=True)
    except Exception:
        return str(value).strip()
