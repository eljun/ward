#!/usr/bin/env python3
"""
summary_request.py — summarize the last stored long assistant response.
"""

import os
import sys
from datetime import datetime, timezone


SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPTS_DIR)


def main() -> int:
    cwd = os.getcwd()

    from brain import run as brain_run
    from speak import speak
    from state_store import load_config, load_state, merge_state, trim_recent_lines, write_state

    config = load_config()
    state_path, state = load_state(cwd, config)

    long_response = state.get("last_long_response", "").strip()
    if not long_response:
        speak("Nothing queued for summary right now.")
        return 0

    context = {
        "project": state.get("project", ""),
        "cwd": cwd,
        "user_request": state.get("last_user_request", ""),
        "assistant_response": state.get("last_assistant_response", ""),
        "long_response": long_response,
        "recent_ward_lines": state.get("recent_ward_lines", []),
    }

    speech = brain_run(event="summary_request", context=context, mode="summary").strip()
    if not speech:
        speech = "I couldn't get a clean summary out of that response."

    speak(speech)

    max_recent = config.get("proactive", {}).get("max_recent_ward_lines", 5)
    updated_state = merge_state(
        state,
        {
            "recent_ward_lines": trim_recent_lines(
                list(state.get("recent_ward_lines", [])) + [speech],
                max_recent,
            ),
            "last_spoken_at": datetime.now(timezone.utc).isoformat(),
            "last_spoken_reason": "summary_request",
            "summary_offer_available": False,
        },
    )
    write_state(state_path, updated_state)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[ward] summary_request error: {exc}", file=sys.stderr)
        raise SystemExit(0)
