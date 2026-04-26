# TASKS

## Planned

- [ ] `5` Warm-Start Pipeline, Overview, Handoff, and TTS
  - Doc: [docs/task/005-warm-start-overview-handoff.md](docs/task/005-warm-start-overview-handoff.md)
  - Goal: Precompute pipeline; daily brief (structured + narrated); Overview screen; end-of-session handoff writer; browser TTS.

- [ ] `6` Plan Mode and Code-Context Service
  - Doc: [docs/task/006-plan-mode.md](docs/task/006-plan-mode.md)
  - Goal: 5-round Plan Mode with simulated participants; Plan Packet schema and persistence; Code-Context Service (repo snapshot, symbol map).

- [ ] `7` Harness Abstraction, Lifecycle, and Watchdog
  - Doc: [docs/task/007-harness-lifecycle.md](docs/task/007-harness-lifecycle.md)
  - Goal: Visible (PTY) and headless harness modes; lifecycle state machine; worker status protocol; watchdog; allowlist enforcement; stub worker.

- [ ] `8` Real Agent Adapters and Cost Ledger
  - Doc: [docs/task/008-real-agent-adapters.md](docs/task/008-real-agent-adapters.md)
  - Goal: Claude Code + Codex CLI adapters (subscription auth default); SDK / API / local opt-ins; full cost ledger with three accounting modes.

- [ ] `9` MCP Connections Layer
  - Doc: [docs/task/009-mcp-connections.md](docs/task/009-mcp-connections.md)
  - Goal: Three-scope MCP registry (global / workspace / repo, reuses `.mcp.json`); secrets via OS keychain; tool routing; autonomy-class policy; WARD-as-MCP-server.

- [ ] `10` Inbound Remote Messaging
  - Doc: [docs/task/010-inbound-remote-messaging.md](docs/task/010-inbound-remote-messaging.md)
  - Goal: Slack Socket Mode + Telegram long-poll; signature verification; sender/command allowlist; Intervention round-trip; presence-aware routing; audit log.

- [ ] `11` Learning Loop
  - Doc: [docs/task/011-learning-loop.md](docs/task/011-learning-loop.md)
  - Goal: Outcome capture; preference inference (shadow → confirm); routing heuristics; playbooks; reversible / inspectable learned data.

- [ ] `12` Hardening
  - Doc: [docs/task/012-hardening.md](docs/task/012-hardening.md)
  - Goal: Backup / restore; cost cap polish; tunneling guide; observability polish; export; documentation pass.

## In Progress

None

## Testing

- `bun install --frozen-lockfile`
- `bun run build`
- `WARD_HOME=/tmp/ward-codex-smoke bun run ward --json init`
- `WARD_HOME=/tmp/ward-codex-smoke bun run ward --json up`
- unauthenticated `GET /api/health` returns 401
- authenticated `GET /api/health` returns 200
- runtime-served UI root returns 200 and contains WARD shell
- second `ward up` fails with a clear single-instance error
- `WARD_HOME=/tmp/ward-codex-smoke bun run ward --json doctor`
- `WARD_HOME=/tmp/ward-codex-smoke bun run ward --json down`
- `ward status` cold-start measurement: 35 ms in smoke home
- `WARD_HOME=/tmp/ward-codex-smoke bun run ward --json profile set display_name Eleazar`
- `WARD_HOME=/tmp/ward-codex-smoke bun run ward --json create-workspace "Task Three Smoke" --description "Task 003 verification" --repo /Users/eleazarjunsan/Code/Personal/ward`
- `WARD_HOME=/tmp/ward-codex-smoke bun run ward --json task create task-three-smoke "Verify task workflow" --type feature --priority high`
- task transition `idea -> planned`, approval gate open/approve, and event API verified
- markdown, text, and PDF attachment ingestion verified with extracted text files
- unsupported attachment type rejects with clear error
- task artifact attach verified with SHA-256 checksum
- repeated `ward init` leaves schema at version 2 with no new migrations
- `WARD_HOME=/tmp/ward-codex-smoke bun run ward --json doctor`
- `WARD_HOME=/tmp/ward-codex-task004-smoke bun run ward --json init`
- fresh init creates `~/.ward/memory/.git`, universal wiki seed pages, and schema version 3
- `WARD_HOME=/tmp/ward-codex-task004-smoke bun run ward --json doctor`
- `WARD_HOME=/tmp/ward-codex-task004-smoke bun run ward --json create-workspace "Task Four Smoke" --description "Wiki memory verification" --repo /Users/eleazarjunsan/Code/Personal/ward`
- workspace creation seeds `workspaces/task-four-smoke/wiki/*.md` and commits `[user] workspace: seed task-four-smoke`
- `ward wiki list`, `ward wiki read`, and `ward wiki history` verified for universal and workspace scopes
- `ward search verification --scope task-four-smoke` returns the workspace wiki overview hit
- API wiki write commits `[user] wiki: smoke decisions` and incremental FTS returns the updated `decisions.md` hit
- API wiki append with `author: "llm"` commits `[llm] wiki: llm session note` and indexes the appended text
- `ward wiki reindex` rebuilds the FTS index successfully
- LLM write over a dirty wiki page rejects with `wiki.conflict_detected`
- `ward wiki lint --scope task-four-smoke` returns no findings for seeded pages
- runtime-served built UI root returns 200 and serves Vite assets
- `bun run build`

## Done

- [x] `4` Git-Backed Wiki Memory
  - Doc: [docs/task/004-wiki-memory.md](docs/task/004-wiki-memory.md)
  - Goal: Universal + per-workspace wikis backed by git; conventions; FTS5 search across wiki, sessions, plan packets; lint pass.

- [x] `3` Workspace State, User Profile, and Attachments
  - Doc: [docs/task/003-workspace-state.md](docs/task/003-workspace-state.md)
  - Goal: SQLite schema for workspaces, tasks, sessions, events, preferences; user profile; attachment intake (markdown / text / PDF).

- [x] `2` Runtime Skeleton
  - Doc: [docs/task/002-runtime-skeleton.md](docs/task/002-runtime-skeleton.md)
  - Goal: macOS-first Bun + TypeScript monorepo, daemon + CLI, auth, single-instance, migrations, structured logging, health UI, `ward doctor`, PTY smoke.

- [x] `1` WARD Tech Plan (epic, planning-only)
  - Doc: [docs/task/001-personal-orchestrator-command-center.md](docs/task/001-personal-orchestrator-command-center.md)
  - Goal: Lock architecture, contracts, schemas, and non-functional requirements that all sub-tasks (002–012) conform to. No code.
  - Appendices:
    - [Extension Seams](docs/task/001/extension-seams.md)
    - [Agent Contract](docs/task/001/agent-contract.md)
    - [Task Workflow Model](docs/task/001/task-workflow-model.md)
    - [Brain Registry](docs/task/001/brain-registry.md)
    - [Orchestrator Modes](docs/task/001/orchestrator-modes.md)
    - [Harness Contract](docs/task/001/harness-contract.md)
    - [Event Taxonomy](docs/task/001/event-taxonomy.md)
    - [Plan Packet Schema](docs/task/001/plan-packet-schema.md)
    - [MCP Registry](docs/task/001/mcp-registry.md)
    - [Security Model](docs/task/001/security-model.md)
    - [Quota](docs/task/001/quota.md)
    - [Warm-Start](docs/task/001/warm-start.md)
