"""
turn_runtime.py — shared turn processing runtime for WARD.

This keeps proactive gating, state updates, and decision handling independent
from any specific session source such as Claude hooks or Codex observers.
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone


DEFAULT_PROACTIVE = {
    "enabled": True,
    "cooldown_seconds": 30,
    "long_response_chars": 900,
    "min_response_chars": 140,
    "conversation_min_chars": 60,
    "significant_file_count": 3,
    "max_recent_ward_lines": 10,
}
INTERESTING_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"}
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


def ensure_turn_shape(turn: dict | None) -> dict:
    turn = dict(turn or {})
    assistant_text = str(turn.get("assistant_text", "")).strip()
    user_text = str(turn.get("user_text", "")).strip()
    tools = list(turn.get("tools", []) or [])
    tool_results = [str(item).strip() for item in turn.get("tool_results", []) if str(item).strip()]
    files_touched = sorted(str(path).strip() for path in turn.get("files_touched", []) if str(path).strip())

    signature = str(turn.get("signature", "")).strip()
    if not signature:
        signature_source = json.dumps(
            {
                "user_text": user_text[:400],
                "assistant_text": assistant_text[:1000],
                "tools": tools,
            },
            sort_keys=True,
        )
        signature = hashlib.sha1(signature_source.encode()).hexdigest()

    return {
        "user_text": user_text,
        "assistant_text": assistant_text,
        "assistant_excerpt": str(turn.get("assistant_excerpt", "")).strip() or assistant_text[:500],
        "assistant_chars": int(turn.get("assistant_chars", len(assistant_text) or 0)),
        "tools": tools,
        "tool_results": tool_results[:6],
        "files_touched": files_touched,
        "signature": signature,
    }


def gate_turn(turn: dict, state: dict, config: dict) -> dict:
    proactive = {**DEFAULT_PROACTIVE, **config.get("proactive", {})}
    turn = ensure_turn_shape(turn)

    if not proactive.get("enabled", True):
        return {"should_call_brain": False, "reason": "disabled", "signals": [], "config": proactive}
    if not turn:
        return {"should_call_brain": False, "reason": "no_turn", "signals": [], "config": proactive}
    if turn["signature"] == state.get("last_seen_turn_signature"):
        return {"should_call_brain": False, "reason": "duplicate_turn", "signals": [], "config": proactive}

    signals = []
    assistant_text = turn.get("assistant_text", "")
    assistant_chars = turn.get("assistant_chars", 0)
    tool_names = {tool.get("tool", "") for tool in turn.get("tools", [])}
    tool_text = " ".join(
        " ".join(filter(None, [tool.get("command", ""), tool.get("description", ""), tool.get("file_path", "")]))
        for tool in turn.get("tools", [])
    )
    combined_text = " ".join([assistant_text, tool_text, " ".join(turn.get("tool_results", []))])

    if assistant_chars >= proactive["long_response_chars"]:
        signals.append("long_response")
    if len(turn.get("files_touched", [])) >= proactive["significant_file_count"]:
        signals.append("multi_file_change")
    if tool_names & INTERESTING_TOOLS and assistant_chars >= proactive["min_response_chars"]:
        signals.append("implementation_turn")
    if _text_contains_any(combined_text, RISKY_KEYWORDS):
        signals.append("risk")
    if _text_contains_any(assistant_text, COMPLETION_KEYWORDS):
        signals.append("completion")
    if not signals and assistant_chars >= proactive["conversation_min_chars"]:
        signals.append("conversation_turn")

    if not signals:
        return {"should_call_brain": False, "reason": "routine_turn", "signals": [], "config": proactive}

    if _cooldown_active(state, proactive["cooldown_seconds"]) and "risk" not in signals:
        return {"should_call_brain": False, "reason": "cooldown", "signals": signals, "config": proactive}

    return {"should_call_brain": True, "reason": "signal_detected", "signals": signals, "config": proactive}


def parse_decision(raw: str) -> dict:
    raw = (raw or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            parsed = json.loads(raw[start : end + 1])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return {}


def build_state_update(turn: dict, state: dict, decision: dict, gate: dict) -> dict:
    proactive = gate.get("config", DEFAULT_PROACTIVE)
    summary_offer_available = bool(
        decision.get("summary_offer_available")
        or ("long_response" in gate.get("signals", []))
    )
    recent_lines = list(state.get("recent_ward_lines", []))
    speech = str(decision.get("speech", "")).strip()
    if speech:
        recent_lines.append(speech)

    update = {
        "last_seen_turn_signature": turn.get("signature", ""),
        "last_user_request": turn.get("user_text", "")[:2000],
        "last_assistant_response": turn.get("assistant_text", "")[:4000],
        "last_long_response": turn.get("assistant_text", "")[:12000] if summary_offer_available else "",
        "summary_offer_available": summary_offer_available,
        "recent_ward_lines": recent_lines[-proactive["max_recent_ward_lines"] :],
    }

    if speech:
        update["last_spoken_at"] = datetime.now(timezone.utc).isoformat()
        update["last_spoken_reason"] = decision.get("reason", "")
    return update


def process_turn(
    *,
    cwd: str,
    turn: dict,
    project_name: str = "",
    output_mode: str = "speak",
    event_name: str = "post_response",
) -> dict:
    from brain import run as brain_run
    from speak import speak
    from state_store import find_project_config, load_config, load_state, merge_state, write_state

    config = load_config()
    state_path, state = load_state(cwd, config)
    _, project_config = find_project_config(cwd, config)
    resolved_project_name = project_name or project_config.get("project_name") or state.get("project", "")
    turn = ensure_turn_shape(turn)
    gate = gate_turn(turn, state, config)

    decision = {}
    if gate["should_call_brain"]:
        context = {
            "project": resolved_project_name,
            "cwd": cwd,
            "user_request": turn.get("user_text", ""),
            "assistant_response": turn.get("assistant_text", ""),
            "assistant_excerpt": turn.get("assistant_excerpt", ""),
            "tools": turn.get("tools", []),
            "tool_results": turn.get("tool_results", []),
            "files_touched": turn.get("files_touched", []),
            "signals": gate.get("signals", []),
            "recent_ward_lines": state.get("recent_ward_lines", []),
            "last_spoken_reason": state.get("last_spoken_reason", ""),
            "summary_offer_available": state.get("summary_offer_available", False),
        }
        try:
            decision = parse_decision(brain_run(event=event_name, context=context, mode="decision"))
        except Exception as exc:
            print(f"[ward] turn runtime brain call failed: {exc}", file=sys.stderr)
            decision = {}

    state_update = build_state_update(turn, state, decision, gate)
    next_state = merge_state(state, state_update)
    try:
        write_state(state_path, next_state)
    except Exception as exc:
        print(f"[ward] turn runtime state write failed: {exc}", file=sys.stderr)

    speech = str(decision.get("speech", "")).strip()
    spoke = False
    if decision.get("should_speak") and speech:
        if output_mode == "speak":
            speak(speech)
            spoke = True
        elif output_mode == "print":
            print(f"[ward] {speech}")
            spoke = True

    return {
        "cwd": cwd,
        "decision": decision,
        "gate": gate,
        "project_name": resolved_project_name,
        "speech": speech,
        "spoke": spoke,
        "state_path": state_path,
        "turn": turn,
    }


def _text_contains_any(text: str, words: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(word in lowered for word in words)


def _cooldown_active(state: dict, seconds: int) -> bool:
    last_spoken_at = state.get("last_spoken_at", "")
    if not last_spoken_at:
        return False
    try:
        spoken_at = datetime.fromisoformat(last_spoken_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    if spoken_at.tzinfo is None:
        spoken_at = spoken_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - spoken_at < timedelta(seconds=seconds)
