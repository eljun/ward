#!/usr/bin/env python3
"""
ward_codex_observe.py — Codex session observer for WARD.

Reads Codex JSON events from stdin, normalizes them into provider-agnostic
session events, accumulates completed turns, and routes them through the shared
WARD turn runtime.
"""

from __future__ import annotations

import argparse
import json
import os
import sys


SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPTS_DIR)

from codex_adapter import normalize_codex_payload
from session_runtime import handle_event
from state_store import find_project_config, load_config


class CodexSessionObserver:
    def __init__(self, *, fallback_cwd: str = "", output_mode: str = "print", dump_events: bool = False):
        self.fallback_cwd = os.path.realpath(fallback_cwd) if fallback_cwd else ""
        self.output_mode = output_mode
        self.dump_events = dump_events
        self.config = load_config()
        self.active_thread_id = ""
        self.active_turn_id = ""
        self.thread_meta: dict[str, dict] = {}
        self.turn_state: dict[tuple[str, str], dict] = {}
        self.latest_turn_by_thread: dict[str, str] = {}
        self.turn_sequence_by_thread: dict[str, int] = {}

    def handle_payload(self, payload: dict, source: str) -> None:
        events = normalize_codex_payload(payload, source=source)
        for event in events:
            event = self._enrich_event(event)
            if self.dump_events:
                print(json.dumps(event, sort_keys=True), file=sys.stderr)
            self.handle_event(event)

    def handle_event(self, event: dict) -> None:
        kind = event.get("kind", "")
        thread_id = (
            event.get("thread_id", "")
            or event.get("session_id", "")
            or self.active_thread_id
        )
        turn_id = (
            event.get("turn_id", "")
            or self.latest_turn_by_thread.get(thread_id, "")
            or self.active_turn_id
        )

        if kind in {"session_started", "session_resumed"}:
            cwd = self._resolve_cwd(event.get("cwd", ""))
            project_name = self._resolve_project_name(cwd, event.get("project_name", ""))
            self.thread_meta[thread_id] = {"cwd": cwd, "project_name": project_name}
            if thread_id:
                self.active_thread_id = thread_id
            return

        if kind == "turn_started":
            if thread_id:
                self.active_thread_id = thread_id
            if not turn_id:
                turn_id = self._allocate_turn_id(thread_id)
                event["turn_id"] = turn_id
            self.active_turn_id = turn_id
            if thread_id:
                self.latest_turn_by_thread[thread_id] = turn_id
            self._turn_record(thread_id, turn_id)
            return

        if not thread_id:
            return

        record = self._turn_record(thread_id, turn_id)

        if kind == "user_message":
            if event.get("content", "").strip():
                record["user_text"] = event["content"].strip()
            return

        if kind == "assistant_message_delta":
            item_id = event.get("message_id", "") or f"delta-{len(record['assistant_order'])}"
            if item_id not in record["assistant_parts"]:
                record["assistant_parts"][item_id] = ""
                record["assistant_order"].append(item_id)
            record["assistant_parts"][item_id] += event.get("content", "")
            return

        if kind == "assistant_message_completed":
            item_id = event.get("message_id", "") or f"message-{len(record['assistant_order'])}"
            if item_id not in record["assistant_parts"]:
                record["assistant_order"].append(item_id)
            record["assistant_parts"][item_id] = event.get("content", "").strip()
            return

        if kind in {"tool_call", "tool_result"}:
            tool_name = event.get("tool_name", "").strip()
            tool_input = event.get("tool_input", {}) if isinstance(event.get("tool_input"), dict) else {}
            record["tools"].append(
                {
                    "tool": tool_name,
                    "file_path": "",
                    "command": str(tool_input.get("command", "")).strip()[:180],
                    "description": _tool_description(tool_name, tool_input),
                }
            )
            output = str(event.get("tool_output", "") or event.get("content", "")).strip()
            if output:
                record["tool_results"].append(output[:300])
            for path in event.get("files_touched", []) or []:
                if path:
                    record["files_touched"].add(str(path))
            return

        if kind == "turn_completed":
            meta = self.thread_meta.get(thread_id, {})
            cwd = meta.get("cwd") or self.fallback_cwd
            if not cwd:
                return

            assistant_text = "\n".join(
                record["assistant_parts"].get(item_id, "").strip()
                for item_id in record["assistant_order"]
                if record["assistant_parts"].get(item_id, "").strip()
            ).strip()
            turn = {
                "user_text": record["user_text"].strip(),
                "assistant_text": assistant_text,
                "tools": record["tools"],
                "tool_results": record["tool_results"],
                "files_touched": sorted(record["files_touched"]),
            }
            completed_event = {
                **event,
                "cwd": cwd,
                "project_name": meta.get("project_name", ""),
                "turn": turn,
            }
            result = handle_event(completed_event, output_mode=self.output_mode)
            if self.dump_events:
                print(json.dumps({"runtime_result": result}, sort_keys=True), file=sys.stderr)
            self.turn_state.pop((thread_id, turn_id), None)
            if self.active_turn_id == turn_id:
                self.active_turn_id = ""

    def _turn_record(self, thread_id: str, turn_id: str) -> dict:
        if not turn_id:
            turn_id = "__unknown__"
        key = (thread_id, turn_id)
        if key not in self.turn_state:
            self.turn_state[key] = {
                "assistant_order": [],
                "assistant_parts": {},
                "files_touched": set(),
                "tool_results": [],
                "tools": [],
                "user_text": "",
            }
        self.latest_turn_by_thread[thread_id] = turn_id
        return self.turn_state[key]

    def _resolve_cwd(self, cwd: str) -> str:
        if cwd:
            return os.path.realpath(cwd)
        return self.fallback_cwd

    def _resolve_project_name(self, cwd: str, project_name: str) -> str:
        if project_name:
            return project_name
        _, project_config = find_project_config(cwd, self.config)
        return project_config.get("project_name", "")

    def _allocate_turn_id(self, thread_id: str) -> str:
        key = thread_id or "__unknown_thread__"
        sequence = self.turn_sequence_by_thread.get(key, 0) + 1
        self.turn_sequence_by_thread[key] = sequence
        return f"{key}:turn:{sequence}"

    def _enrich_event(self, event: dict) -> dict:
        enriched = dict(event)
        thread_id = (
            enriched.get("thread_id", "")
            or enriched.get("session_id", "")
            or self.active_thread_id
        )
        turn_id = (
            enriched.get("turn_id", "")
            or self.latest_turn_by_thread.get(thread_id, "")
            or self.active_turn_id
        )
        enriched["thread_id"] = thread_id
        enriched["session_id"] = enriched.get("session_id", "") or thread_id
        enriched["turn_id"] = turn_id

        meta = self.thread_meta.get(thread_id, {})
        cwd = self._resolve_cwd(enriched.get("cwd", "") or meta.get("cwd", ""))
        enriched["cwd"] = cwd
        enriched["project_name"] = self._resolve_project_name(cwd, enriched.get("project_name", "") or meta.get("project_name", ""))
        return enriched


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Observe Codex JSON events and feed them into WARD.")
    parser.add_argument(
        "--source",
        choices=("auto", "app-server", "exec-json"),
        default="auto",
        help="Input stream format. Defaults to auto-detection.",
    )
    parser.add_argument(
        "--output",
        choices=("print", "silent", "speak"),
        default="print",
        help="How WARD should emit proactive output for completed turns.",
    )
    parser.add_argument(
        "--cwd",
        default="",
        help="Fallback project cwd when the incoming Codex events do not include one.",
    )
    parser.add_argument(
        "--dump-events",
        action="store_true",
        help="Print normalized session events to stderr for debugging.",
    )
    return parser.parse_args(argv)


def main() -> int:
    args = parse_args(sys.argv[1:])
    observer = CodexSessionObserver(
        fallback_cwd=args.cwd or os.getcwd(),
        output_mode=args.output,
        dump_events=args.dump_events,
    )

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except Exception:
            print(f"[ward] Ignoring non-JSON input: {line[:120]}", file=sys.stderr)
            continue
        observer.handle_payload(payload, source=args.source)

    return 0


def _tool_description(tool_name: str, tool_input: dict) -> str:
    if tool_name == "Bash":
        return str(tool_input.get("cwd", "")).strip()[:180]
    return ""


if __name__ == "__main__":
    raise SystemExit(main())
