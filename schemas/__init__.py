"""
schemas — provider-agnostic event schema for WARD.

WARD originally coupled itself to Claude Code hook payload shapes. The Codex
integration (task 001) requires a normalized event model so adapters for
different coding agents can feed the same runtime.
"""

from .events import (
    EVENT_TYPES,
    SessionEvent,
    TurnEvent,
    make_event,
)

__all__ = [
    "EVENT_TYPES",
    "SessionEvent",
    "TurnEvent",
    "make_event",
]
