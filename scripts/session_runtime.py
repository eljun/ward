"""
session_runtime.py — shared event runtime for WARD session adapters.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import date


LAST_ERROR_PATH = os.path.join(tempfile.gettempdir(), "ward_last_error.json")


def handle_event(event: dict, *, output_mode: str = "speak") -> dict:
    kind = str(event.get("kind", "")).strip()

    if kind in {"session_started", "session_resumed"}:
        return _handle_session_start(event, output_mode=output_mode)
    if kind == "tool_result":
        return _handle_tool_result(event, output_mode=output_mode)
    if kind == "turn_completed":
        return _handle_turn_completed(event, output_mode=output_mode)
    if kind == "session_ended":
        return _handle_session_end(event, output_mode=output_mode)
    if kind == "prompt_submitted":
        return {"handled": False, "kind": kind, "reason": "not_implemented"}
    return {"handled": False, "kind": kind, "reason": "unsupported"}


def _handle_session_start(event: dict, *, output_mode: str) -> dict:
    from brain import run as brain_run
    from speak import speak
    from state_store import find_project_config, load_config, load_state

    cwd = _resolve_cwd(event)
    config = load_config()
    _, state = load_state(cwd, config)
    _, project_config = find_project_config(cwd, config)
    project_name = project_config.get("project_name") or state.get("project", "")

    context = {
        "last_active": state.get("last_active", ""),
        "current_task": state.get("current_task", ""),
        "top_priorities": state.get("top_priorities", []),
        "pending_prs": state.get("pending_prs", []),
        "last_summary": state.get("last_summary", ""),
        "project": project_name,
    }

    today = date.today().isoformat()
    if state.get("last_active", "") == today:
        speech = brain_run(event="session_start_same_day", context=context, mode="speak")
    else:
        speech = brain_run(event="session_start", context=context, mode="speak")

    spoke = _emit_output(speech, output_mode)
    return {"handled": True, "kind": event.get("kind", ""), "speech": speech, "spoke": spoke}


def _handle_tool_result(event: dict, *, output_mode: str) -> dict:
    from brain import run as brain_run

    if str(event.get("status", "")).strip().lower() != "failed":
        return {"handled": False, "kind": event.get("kind", ""), "reason": "non_failure_tool_result"}

    tool_name = str(event.get("tool_name", "")).strip()
    tool_error = str(event.get("tool_output", "") or event.get("content", "")).strip()
    if not tool_error:
        return {"handled": False, "kind": event.get("kind", ""), "reason": "no_tool_error"}

    if _is_duplicate_tool_error(tool_name, tool_error):
        return {"handled": False, "kind": event.get("kind", ""), "reason": "duplicate_error"}

    _save_last_error(tool_name, tool_error)
    speech = brain_run(
        event="tool_error",
        context={"tool_name": tool_name, "tool_error": tool_error},
        mode="speak",
    )
    spoke = _emit_output(speech, output_mode)
    return {"handled": True, "kind": event.get("kind", ""), "speech": speech, "spoke": spoke}


def _handle_turn_completed(event: dict, *, output_mode: str) -> dict:
    from turn_runtime import process_turn

    turn = event.get("turn", {})
    if not isinstance(turn, dict) or not turn:
        return {"handled": False, "kind": event.get("kind", ""), "reason": "missing_turn"}

    return {
        "handled": True,
        "kind": event.get("kind", ""),
        "result": process_turn(
            cwd=_resolve_cwd(event),
            turn=turn,
            project_name=str(event.get("project_name", "")).strip(),
            output_mode=output_mode,
        ),
    }


def _handle_session_end(event: dict, *, output_mode: str) -> dict:
    from brain import run as brain_run
    from speak import speak
    from state_store import find_project_config, load_config, load_state, merge_state, write_state

    cwd = _resolve_cwd(event)
    config = load_config()
    state_path, current_state = load_state(cwd, config)

    project_root, project_config = find_project_config(cwd, config)
    if project_config.get("project_name"):
        current_state["project"] = project_config["project_name"]
    if project_config.get("tasks_md_path"):
        tasks_base = project_root or cwd
        current_state["tasks_md_path"] = os.path.join(tasks_base, project_config["tasks_md_path"])

    context = {
        "transcript_events": event.get("transcript_events", []),
        "previous_state": current_state,
        "cwd": cwd,
    }

    raw_state = brain_run(event="session_end", context=context, mode="state")
    try:
        new_state = json.loads(raw_state)
        if isinstance(new_state, dict):
            merged = merge_state(current_state, {**new_state, "last_active": date.today().isoformat()})
            write_state(state_path, merged)
    except Exception as exc:
        print(f"[ward] Could not parse state update from brain: {exc}", file=sys.stderr)
        current_state["last_active"] = date.today().isoformat()
        write_state(state_path, current_state)

    speech = "Alright, wrapping up. I've saved your session summary."
    spoke = _emit_output(speech, output_mode)
    return {"handled": True, "kind": event.get("kind", ""), "speech": speech, "spoke": spoke}


def _resolve_cwd(event: dict) -> str:
    cwd = str(event.get("cwd", "")).strip()
    return cwd or os.getcwd()


def _emit_output(speech: str, output_mode: str) -> bool:
    speech = str(speech or "").strip()
    if not speech:
        return False
    if output_mode == "print":
        print(f"[ward] {speech}")
        return True
    if output_mode == "speak":
        from speak import speak

        speak(speech)
        return True
    return False


def _load_last_error() -> dict:
    try:
        with open(LAST_ERROR_PATH) as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_last_error(tool_name: str, tool_error: str) -> None:
    try:
        with open(LAST_ERROR_PATH, "w") as handle:
            json.dump({"tool_name": tool_name, "tool_error": tool_error}, handle)
    except Exception:
        pass


def _is_duplicate_tool_error(tool_name: str, tool_error: str) -> bool:
    last_error = _load_last_error()
    return (
        last_error.get("tool_name") == tool_name
        and last_error.get("tool_error") == tool_error
    )
