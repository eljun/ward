"""
gating.py — provider-agnostic proactive gate.

Lifted from `hooks/post_response.py` so the Codex adapter shares the same gate.
Hooks keep their own thin wrappers for backwards compatibility, but the gating
logic is now singular and lives here.
"""

from datetime import datetime, timedelta, timezone

from .turn import COMPLETION_KEYWORDS, INTERESTING_TOOLS, RISKY_KEYWORDS


DEFAULT_PROACTIVE = {
    "enabled": True,
    "cooldown_seconds": 30,
    "long_response_chars": 900,
    "min_response_chars": 140,
    "conversation_min_chars": 60,
    "significant_file_count": 3,
    "max_recent_ward_lines": 10,
}


def _text_contains_any(text: str, words: tuple) -> bool:
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


def gate_turn(turn: dict, state: dict, config: dict) -> dict:
    """Return a gate decision for the given turn.

    Decision shape:
      {
        "should_call_brain": bool,
        "reason": str,
        "signals": list[str],
        "config": dict,
      }
    """
    proactive = {**DEFAULT_PROACTIVE, **config.get("proactive", {})}
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
