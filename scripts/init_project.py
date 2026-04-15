#!/usr/bin/env python3
"""
init_project.py — register the current project in ~/.ward/config.json.

This keeps WARD globally configured while making per-project onboarding a
one-command action.
"""

import json
import os
import sys


SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPTS_DIR)


DEFAULT_CONFIG = {
    "tts_provider": "macos",
    "macos_voice": "Joelle (Enhanced)",
    "elevenlabs_voice_id": "21m00Tcm4TlvDq8ikWAM",
    "elevenlabs_model": "eleven_turbo_v2",
    "persona_name": "Jun",
    "brain_provider": "openai",
    "brain_model": "gpt-5.4-nano",
    "brain_models": {},
    "proactive": {
        "enabled": True,
        "cooldown_seconds": 90,
        "long_response_chars": 900,
        "min_response_chars": 140,
        "significant_file_count": 3,
        "max_recent_ward_lines": 5,
    },
    "speak_on": ["session_start", "errors", "session_end"],
    "projects": {},
}


def parse_args(argv: list[str]) -> dict:
    options = {
        "cwd": os.getcwd(),
        "project_name": "",
        "tasks_md_path": "",
        "force": False,
    }

    idx = 0
    while idx < len(argv):
        arg = argv[idx]
        if arg == "--force":
            options["force"] = True
            idx += 1
            continue
        if arg in {"--cwd", "--name", "--tasks"}:
            if idx + 1 >= len(argv):
                raise ValueError(f"Missing value for {arg}")
            value = argv[idx + 1].strip()
            if arg == "--cwd":
                options["cwd"] = os.path.abspath(os.path.expanduser(value))
            elif arg == "--name":
                options["project_name"] = value
            elif arg == "--tasks":
                options["tasks_md_path"] = value
            idx += 2
            continue
        raise ValueError(f"Unknown argument: {arg}")

    return options


def infer_project_name(cwd: str) -> str:
    base = os.path.basename(cwd.rstrip(os.sep))
    if not base:
        return "Project"
    return " ".join(part.capitalize() for part in base.replace("_", "-").split("-"))


def infer_tasks_path(cwd: str) -> str:
    candidates = ("TASKS.md", "tasks.md", "docs/TASKS.md")
    for candidate in candidates:
        if os.path.exists(os.path.join(cwd, candidate)):
            return candidate
    return "TASKS.md"


def main() -> int:
    options = parse_args(sys.argv[1:])

    from bootstrap import ensure_ward_home
    from state_store import CONFIG_PATH, load_config

    for message in ensure_ward_home(force=False):
        if message.startswith("missing template"):
            print(message, file=sys.stderr)
            return 1

    config = {**DEFAULT_CONFIG, **load_config()}
    config["projects"] = dict(config.get("projects", {}))

    cwd = options["cwd"]
    existing = config["projects"].get(cwd, {})
    if existing and not options["force"]:
        print(f"Project already configured: {cwd}")
        print(json.dumps(existing, indent=2))
        print("Use --force to overwrite this project entry.")
        return 0

    project_name = options["project_name"] or existing.get("project_name") or infer_project_name(cwd)
    tasks_md_path = options["tasks_md_path"] or existing.get("tasks_md_path") or infer_tasks_path(cwd)

    config["projects"][cwd] = {
        "tasks_md_path": tasks_md_path,
        "project_name": project_name,
    }

    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)

    print(f"Configured WARD for project: {cwd}")
    print(json.dumps(config["projects"][cwd], indent=2))
    print("Next step: open Claude Code in this project and run /recap.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[ward] init_project error: {exc}", file=sys.stderr)
        raise SystemExit(1)
