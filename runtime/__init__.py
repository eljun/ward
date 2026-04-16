"""
runtime — provider-agnostic session state machine for WARD.

The runtime accumulates normalized SessionEvent/TurnEvent payloads into a
rolling turn view, applies the proactive gate, and exposes decision hooks for
adapters. All of this used to live inside `hooks/post_response.py`. It was
lifted into its own module so Codex and (later) other adapters can reuse it
instead of duplicating the logic.
"""

from .gating import DEFAULT_PROACTIVE, gate_turn
from .session import SessionRuntime
from .turn import (
    INTERESTING_TOOLS,
    RISKY_KEYWORDS,
    COMPLETION_KEYWORDS,
    build_turn_from_events,
    turn_signature,
)

__all__ = [
    "DEFAULT_PROACTIVE",
    "INTERESTING_TOOLS",
    "RISKY_KEYWORDS",
    "COMPLETION_KEYWORDS",
    "SessionRuntime",
    "build_turn_from_events",
    "gate_turn",
    "turn_signature",
]
