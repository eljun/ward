"""
adapters — provider-specific ingestion modules.

Each adapter is responsible for normalizing its native session stream into
provider-agnostic SessionEvent / TurnEvent payloads that the runtime can
consume.
"""

from .codex import CodexExecAdapter, iter_codex_exec_events

__all__ = [
    "CodexExecAdapter",
    "iter_codex_exec_events",
]
