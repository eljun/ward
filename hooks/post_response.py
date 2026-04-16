#!/usr/bin/env python3
"""
post_response.py — proactive Stop hook for WARD.

Fires after each complete Claude response. Extracts the latest user/assistant
turn, applies a strict local gate, then asks the brain for a short dev-style
comment only when there is real signal. Silent by default.
"""

import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone


HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(HOOKS_DIR)
SCRIPTS_DIR = os.path.join(REPO_DIR, "scripts")
sys.path.insert(0, SCRIPTS_DIR)

DEFAULT_PROACTIVE = {
    "enabled": True,
    "cooldown_seconds": 30,
    "long_response_chars": 900,
    "min_response_chars": 140,
    "conversation_min_chars": 60,
    "significant_file_count": 3,
    "max_recent_ward_lines": 10,
}
MAX_LINES = 200
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


def read_recent_transcript(path: str) -> list[dict]:
    if not path or not os.path.exists(path):
        return []
    lines = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    lines.append(json.loads(line))
                except Exception:
                    pass
    except Exception:
        pass
    return lines[-MAX_LINES:]


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
    # Transcript entries use top-level "type" field for role (user/assistant).
    # Older formats may use "role" directly. The nested message object also has
    # a "role" field — check all three locations.
    t = entry.get("type", "")
    if t in ("user", "assistant"):
        return t
    return entry.get("role", "") or entry.get("message", {}).get("role", "")


def _entry_blocks(entry: dict) -> list[dict]:
    # Content is nested inside entry.message.content in current transcript format.
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
    """Return True only for actual human messages, not tool result callbacks."""
    if _entry_role(entry) != "user":
        return False
    blocks = _entry_blocks(entry)
    # Tool result callbacks have tool_result blocks; human messages have text or are empty
    return not any(b.get("type") == "tool_result" for b in blocks)


def _entry_text(entry: dict) -> str:
    parts = []
    for block in _entry_blocks(entry):
        if block.get("type") == "text":
            text = block.get("text", "").strip()
            if text:
                parts.append(text)
    return "\n".join(parts).strip()


def _tool_brief(block: dict) -> dict:
    inp = block.get("input", {}) if isinstance(block.get("input"), dict) else {}
    brief = {
        "tool": block.get("name", ""),
        "file_path": inp.get("file_path") or inp.get("path") or inp.get("filePath") or "",
        "command": (inp.get("command") or "")[:180],
        "description": (inp.get("description") or "")[:180],
    }
    return brief


def collect_latest_turn(entries: list[dict]) -> dict:
    assistant_index = None
    for idx in range(len(entries) - 1, -1, -1):
        if _entry_role(entries[idx]) == "assistant":
            assistant_index = idx
            break
    if assistant_index is None:
        return {}

    # Walk back to the actual human message, skipping tool result callbacks
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


def gate_turn(turn: dict, state: dict, config: dict) -> dict:
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
    # Buddy-mode: let pure conversation turns reach the brain so Ward can chime in
    # with short reactions. The brain still decides whether to speak.
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


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}

    transcript_path = payload.get("transcript_path", "")
    cwd = payload.get("cwd", os.getcwd())

    from brain import run as brain_run
    from speak import speak
    from state_store import find_project_config, load_config, load_state, merge_state, write_state

    config = load_config()
    state_path, state = load_state(cwd, config)
    _, project_config = find_project_config(cwd, config)
    project_name = project_config.get("project_name") or state.get("project", "")

    entries = read_recent_transcript(transcript_path)
    turn = collect_latest_turn(entries)
    gate = gate_turn(turn, state, config)

    decision = {}
    if gate["should_call_brain"]:
        context = {
            "project": project_name,
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
        decision = parse_decision(brain_run(event="post_response", context=context, mode="decision"))

    state_update = build_state_update(turn, state, decision, gate)
    next_state = merge_state(state, state_update)
    write_state(state_path, next_state)

    speech = str(decision.get("speech", "")).strip()
    if decision.get("should_speak") and speech:
        speak(speech)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[ward] post_response error: {e}", file=sys.stderr)
        sys.exit(0)
