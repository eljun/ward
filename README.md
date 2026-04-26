# WARD

WARD is a **local-first, single-user developer command center and
orchestrator**. One developer runs it on their workstation. It unifies
workspace overview, multi-model planning (Plan Mode), agent harnesses
that wrap Claude Code and Codex, wiki-first memory, MCP-based connections
to external services (GitHub, Slack, Vercel, Supabase, etc.), and
remote messaging for when the developer is away.

## Status

WARD's architecture is **frozen after Task 001**. Application code has not
been written yet. The repository currently contains the frozen technical plan
and per-phase task documents that downstream implementation tasks will follow.
Next up: Task 002, the Bun + TypeScript runtime skeleton.

## Planning Artifacts

- [TASKS.md](TASKS.md) — full task list with status
- [docs/task/001-personal-orchestrator-command-center.md](docs/task/001-personal-orchestrator-command-center.md)
  — the canonical tech plan (epic, planning-only)
- [Appendices under `docs/task/001/`](docs/task/001/) — Extension Seams,
  Agent Contract, Task Workflow Model, Brain Registry, Orchestrator Modes,
  Harness Contract, Event Taxonomy, Plan Packet Schema, MCP Registry,
  Security Model, Quota, Warm-Start
- [Sub-task docs `docs/task/002-` through `012-`](docs/task/) — each
  implementation phase with its own scope and acceptance criteria

## Architecture (one paragraph)

WARD is a single long-running **Runtime** (Bun + TypeScript daemon) plus a
browser UI served by that runtime on `127.0.0.1`. The Runtime is
deterministic code: HTTP API, SSE event bus, WebSocket PTY mux, queue,
warm-start cache, MCP client, harness lifecycle. An **Orchestrator Brain**
(pluggable LLM, configured via the Brain Registry) is invoked by the
Runtime when prose, moderation, or reasoning is needed. The default
worker harness wraps the **Claude Code** and **Codex** CLIs using the
user's existing subscription auth — no API key required. Agent SDK and
raw API are opt-in alternatives. All third-party connections (GitHub,
Slack, Vercel, Supabase, etc.) go through **MCP servers** with three
configuration scopes: global, workspace, and repo (the repo scope reuses
Claude Code's native `.mcp.json` format). Operational state lives in
SQLite. Compiled memory lives in a git-backed `~/.ward/memory/` wiki.
Task docs, test reports, evidence packets, and session events form WARD's
hard-memory layer for coding agents.

## Tech Stack

- **Runtime**: Bun + TypeScript (single runtime for daemon + CLI + UI
  server + bundler).
- **Storage**: SQLite (`bun:sqlite`) for operational state; git-backed
  filesystem for wiki memory; OS keychain for secrets.
- **UI**: Vite + lean React SPA (no Next.js, no SSR framework). Served by the
  Runtime.
- **Workers**: Claude Code CLI and Codex CLI by default (subscription
  auth); SDK / API / local LLM as alternatives via Brain Registry.
- **Connections**: MCP servers (stdio + http transports).
- **Remote**: Slack Socket Mode (primary) + Telegram long-poll
  (secondary) for outbound alerts and inbound commands.

## Phased Roadmap

| Task | Scope |
|---|---|
| 001 | Tech plan (this doc set) |
| 002 | Runtime skeleton |
| 003 | Workspace state, user profile, attachments |
| 004 | Git-backed wiki memory |
| 005 | Warm-start, overview, handoff, TTS |
| 006 | Plan Mode + code-context service |
| 007 | Harness lifecycle + watchdog |
| 008 | Real Claude Code + Codex adapters + cost ledger |
| 009 | MCP connections layer |
| 010 | Inbound remote messaging |
| 011 | Learning loop |
| 012 | Hardening |

## Architecture Freeze

- [x] [001 tech plan](docs/task/001-personal-orchestrator-command-center.md)
  frozen on 2026-04-26
- [x] Twelve appendices under [docs/task/001/](docs/task/001/) included
- [x] Sub-task docs 002 through 012 scoped
- [x] Contract drift resolved before Task 002

## License

TBD.
