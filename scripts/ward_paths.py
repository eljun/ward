"""
ward_paths.py — shared filesystem path helpers for WARD.
"""

from __future__ import annotations

import os


def ward_home() -> str:
    override = os.environ.get("WARD_HOME", "").strip()
    if override:
        return os.path.realpath(os.path.expanduser(override))
    return os.path.expanduser("~/.ward")


def ward_config_path() -> str:
    return os.path.join(ward_home(), "config.json")


def ward_persona_path() -> str:
    return os.path.join(ward_home(), "persona.txt")
