"""
session.py — rolling session runtime that adapters feed events into.

Adapters push normalized events; the runtime accumulates them into a turn,
calls the gate when a `turn_completed` event arrives, and yields decisions
for output handlers (speak, log, silence).

WARD remains read-only. The runtime never emits tool calls or edits.
"""

import json
import os
import sys
from datetime import datetime, timezone
from typing import Callable, Iterable, Optional

SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from .gating import DEFAULT_PROACTIVE, gate_turn
from .turn import build_turn_from_events


def _parse_decision(raw: str) -> dict:
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


class SessionRuntime:
    """Accumulates normalized events and produces gate/brain decisions.

    Adapters call `ingest(event)` for each event. On `turn_completed` the
    runtime rolls the current turn, applies the gate, optionally calls the
    brain, persists state, and returns the decision via `output_fn(decision)`
    if one is provided.
    """

    def __init__(
        self,
        cwd: str,
        output_fn: Optional[Callable[[dict], None]] = None,
        brain_fn: Optional[Callable[[str, dict, str], str]] = None,
    ) -> None:
        from state_store import find_project_config, load_config, load_state

        self._find_project_config = find_project_config
        self._load_state = load_state

        self.cwd = cwd
        self.output_fn = output_fn or (lambda decision: None)
        self._brain_fn = brain_fn  # lazy-imported on first use
        self.config = load_config()
        self.state_path, self.state = load_state(cwd, self.config)
        project_root, project_config = find_project_config(cwd, self.config)
        self.project_root = project_root
        self.project_name = project_config.get("project_name", "") or self.state.get("project", "")

        self._turn_buffer: list = []

    def ingest(self, event) -> Optional[dict]:
        """Feed one event. Returns a decision dict when a turn completes, else None."""
        event_dict = event.to_dict() if hasattr(event, "to_dict") else dict(event)
        event_type = event_dict.get("type", "")

        if event_type in {"session_started", "session_resumed", "session_ended"}:
            return None

        if event_type == "turn_completed":
            decision = self._finalize_turn()
            self._turn_buffer = []
            return decision

        self._turn_buffer.append(event_dict)
        return None

    def _finalize_turn(self) -> dict:
        turn = build_turn_from_events(self._turn_buffer)
        gate = gate_turn(turn, self.state, self.config)

        decision: dict = {}
        if gate["should_call_brain"]:
            context = {
                "project": self.project_name,
                "cwd": self.cwd,
                "user_request": turn.get("user_text", ""),
                "assistant_response": turn.get("assistant_text", ""),
                "assistant_excerpt": turn.get("assistant_excerpt", ""),
                "tools": turn.get("tools", []),
                "tool_results": turn.get("tool_results", []),
                "files_touched": turn.get("files_touched", []),
                "signals": gate.get("signals", []),
                "recent_ward_lines": self.state.get("recent_ward_lines", []),
                "last_spoken_reason": self.state.get("last_spoken_reason", ""),
                "summary_offer_available": self.state.get("summary_offer_available", False),
            }
            raw = self._call_brain(event="post_response", context=context, mode="decision")
            decision = _parse_decision(raw)

        self._persist(turn, decision, gate)

        envelope = {
            "turn": turn,
            "gate": gate,
            "decision": decision,
        }
        try:
            self.output_fn(envelope)
        except Exception as exc:
            print(f"[ward] output_fn error: {exc}", file=sys.stderr)
        return envelope

    def _call_brain(self, event: str, context: dict, mode: str) -> str:
        if self._brain_fn is None:
            from brain import run as brain_run
            self._brain_fn = brain_run
        return self._brain_fn(event, context, mode)

    def _persist(self, turn: dict, decision: dict, gate: dict) -> None:
        from state_store import merge_state, write_state

        proactive = gate.get("config", DEFAULT_PROACTIVE)
        summary_offer_available = bool(
            decision.get("summary_offer_available")
            or ("long_response" in gate.get("signals", []))
        )
        recent_lines = list(self.state.get("recent_ward_lines", []))
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

        self.state = merge_state(self.state, update)
        write_state(self.state_path, self.state)

    def drain(self, events: Iterable) -> list:
        """Feed an iterable of events, returning any finalized decisions."""
        decisions = []
        for event in events:
            result = self.ingest(event)
            if result is not None:
                decisions.append(result)
        return decisions
