"""
events.py — provider-agnostic session/turn event schema.

Adapters (Claude Code hooks, Codex app-server, Codex `exec --json`) normalize
their native payloads into these shapes before handing control to the WARD
runtime. The runtime never reads a `raw_event` payload shape directly — only
normalized fields.
"""

from dataclasses import asdict, dataclass, field
from typing import Any, Optional


EVENT_TYPES = (
    "session_started",
    "session_resumed",
    "user_message",
    "assistant_message_delta",
    "assistant_message_completed",
    "tool_call",
    "tool_result",
    "turn_completed",
    "session_ended",
)


@dataclass
class SessionEvent:
    """Session-scoped event: start, resume, end."""

    type: str
    provider: str
    session_id: str = ""
    cwd: str = ""
    project_name: str = ""
    timestamp: str = ""
    raw_event: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class TurnEvent:
    """Turn-scoped event: user message, assistant message, tool use, turn completion."""

    type: str
    provider: str
    session_id: str = ""
    turn_id: str = ""
    message_id: str = ""
    cwd: str = ""
    project_name: str = ""
    timestamp: str = ""
    content: str = ""
    tool_name: str = ""
    tool_input: dict = field(default_factory=dict)
    tool_output: str = ""
    raw_event: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


def make_event(event_type: str, provider: str, **fields: Any) -> Optional[Any]:
    """Build a SessionEvent or TurnEvent based on event_type.

    Unknown event types return None so adapters can skip them without raising.
    """
    if event_type not in EVENT_TYPES:
        return None
    session_scoped = {"session_started", "session_resumed", "session_ended"}
    if event_type in session_scoped:
        allowed = {f.name for f in SessionEvent.__dataclass_fields__.values()}
        filtered = {k: v for k, v in fields.items() if k in allowed}
        return SessionEvent(type=event_type, provider=provider, **filtered)
    allowed = {f.name for f in TurnEvent.__dataclass_fields__.values()}
    filtered = {k: v for k, v in fields.items() if k in allowed}
    return TurnEvent(type=event_type, provider=provider, **filtered)
