"""
state_store.py — shared config/state helpers for WARD hooks.
"""

import json
import os
from typing import Any, Optional


WARD_DIR = os.path.expanduser("~/.ward")
CONFIG_PATH = os.path.join(WARD_DIR, "config.json")
STATE_DEFAULTS = {
    "current_task": "",
    "top_priorities": [],
    "recent_completions": [],
    "pending_prs": [],
    "last_summary": "",
    "last_active": "",
    "project": "",
    "tasks_md_path": "",
    "recent_ward_lines": [],
    "last_spoken_at": "",
    "last_spoken_reason": "",
    "last_seen_turn_signature": "",
    "last_user_request": "",
    "last_assistant_response": "",
    "last_long_response": "",
    "summary_offer_available": False,
}


def load_json(path: str) -> dict:
    try:
        with open(path) as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def load_config() -> dict:
    return load_json(CONFIG_PATH)


def ensure_state_shape(state: Optional[dict]) -> dict:
    state = state or {}
    return {**STATE_DEFAULTS, **state}


def get_state_path(cwd: str, config: dict) -> str:
    project_config = config.get("projects", {}).get(cwd, {})
    project_name = project_config.get("project_name", "")
    if project_name:
        safe_name = project_name.lower().replace(" ", "_").replace("-", "_")
        states_dir = os.path.join(WARD_DIR, "states")
        os.makedirs(states_dir, exist_ok=True)
        return os.path.join(states_dir, f"{safe_name}.json")
    return os.path.join(WARD_DIR, "state.json")


def load_state(cwd: str, config: dict) -> tuple[str, dict]:
    state_path = get_state_path(cwd, config)
    return state_path, ensure_state_shape(load_json(state_path))


def write_state(path: str, state: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(state, f, indent=2)


def merge_state(current_state: dict, updates: Optional[dict]) -> dict:
    merged = dict(current_state)
    for key, value in (updates or {}).items():
        merged[key] = value
    return ensure_state_shape(merged)


def trim_recent_lines(lines: list[Any], limit: int) -> list[str]:
    text_lines = [str(line).strip() for line in lines if str(line).strip()]
    if limit <= 0:
        return []
    return text_lines[-limit:]
