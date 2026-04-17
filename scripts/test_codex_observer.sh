#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OBSERVER_PY="$ROOT_DIR/scripts/ward_codex_observe.py"

MODE="${1:-help}"
PROJECT_CWD="${2:-$PWD}"

usage() {
  cat <<EOF
WARD Codex observer test helper

Usage:
  scripts/test_codex_observer.sh synthetic [project_cwd]
  scripts/test_codex_observer.sh exec [project_cwd] [prompt]
  scripts/test_codex_observer.sh help

Modes:
  synthetic   Feed a small synthetic app-server event stream into WARD
  exec        Run a real 'codex exec --json' session and pipe it into WARD

Examples:
  scripts/test_codex_observer.sh synthetic /Users/eleazarjunsan/Code/Work/pipelineforge
  scripts/test_codex_observer.sh exec /Users/eleazarjunsan/Code/Work/pipelineforge "Summarize this repo in 2 sentences"

Notes:
  - 'exec' requires a working local Codex CLI environment.
  - WARD output uses '--output print' so you can see it in the terminal.
  - Set WARD_HOME=/tmp/ward-codex-test if you want isolated WARD state without breaking Codex auth.
  - Add '--dump-events' inside this script if you want normalized event debugging by default.
EOF
}

run_synthetic() {
  PROJECT_CWD_ENV="$PROJECT_CWD" python3 - <<'PY' | python3 "$OBSERVER_PY" --source app-server --output print --cwd "$PROJECT_CWD"
import json
import os

events = [
    {
        "method": "thread/started",
        "params": {
            "thread": {
                "id": "thr_1",
                "cwd": None,
                "status": {"type": "idle"},
            }
        },
    },
    {
        "method": "turn/started",
        "params": {
            "threadId": "thr_1",
            "turn": {"id": "turn_1", "status": "inProgress"},
        },
    },
    {
        "method": "item/completed",
        "params": {
            "threadId": "thr_1",
            "turnId": "turn_1",
            "item": {
                "id": "user_1",
                "type": "userMessage",
                "content": [{"type": "text", "text": "Please explain the latest WARD change."}],
            },
        },
    },
    {
        "method": "item/agentMessage/delta",
        "params": {
            "threadId": "thr_1",
            "turnId": "turn_1",
            "itemId": "msg_1",
            "delta": "I extracted the shared runtime",
        },
    },
    {
        "method": "item/completed",
        "params": {
            "threadId": "thr_1",
            "turnId": "turn_1",
            "item": {
                "id": "cmd_1",
                "type": "commandExecution",
                "command": "git status",
                "commandActions": [],
                "cwd": None,
                "status": "completed",
                "aggregatedOutput": "working tree clean",
            },
        },
    },
    {
        "method": "item/completed",
        "params": {
            "threadId": "thr_1",
            "turnId": "turn_1",
            "item": {
                "id": "msg_1",
                "type": "agentMessage",
                "text": "I extracted the shared turn runtime and added a Codex observer.",
            },
        },
    },
    {
        "method": "turn/completed",
        "params": {
            "threadId": "thr_1",
            "turn": {"id": "turn_1", "status": "completed"},
        },
    },
]

project_cwd = os.environ["PROJECT_CWD_ENV"]
for event in events:
    params = event.get("params", {})
    thread = params.get("thread")
    if isinstance(thread, dict) and thread.get("cwd") is None:
        thread["cwd"] = project_cwd
    item = params.get("item")
    if isinstance(item, dict) and item.get("cwd") is None:
        item["cwd"] = project_cwd
    print(json.dumps(event))
PY
}

run_exec() {
  local prompt="${3:-Summarize this repository in 2 sentences.}"
  codex exec --json --sandbox read-only -C "$PROJECT_CWD" "$prompt" \
    | python3 "$OBSERVER_PY" --source exec-json --output print --cwd "$PROJECT_CWD"
}

case "$MODE" in
  synthetic)
    run_synthetic
    ;;
  exec)
    run_exec "$@"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
