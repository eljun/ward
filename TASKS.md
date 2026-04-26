# TASKS

## Planned

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
- `WARD_HOME=/tmp/ward-codex-task005-smoke bun run ward --json init`
- fresh Task 005 init creates schema version 4 and warm cache snapshots for `daily_brief:<date>` and `overview`
- `WARD_HOME=/tmp/ward-codex-task005-smoke bun run ward --json up`
- daemon startup reports schema version 4 with warm cache prewarmed before health returns
- `WARD_HOME=/tmp/ward-codex-task005-smoke bun run ward --json brief`
- `WARD_HOME=/tmp/ward-codex-task005-smoke bun run ward --json doctor --warm-stats`
- `WARD_HOME=/tmp/ward-codex-task005-smoke bun run ward --json create-workspace "Task Five Smoke" --description "Warm start verification" --repo /Users/eleazarjunsan/Code/Personal/ward`
- `WARD_HOME=/tmp/ward-codex-task005-smoke bun run ward --json task create task-five-smoke "Verify warm handoff" --type feature --priority high`
- `WARD_HOME=/tmp/ward-codex-task005-smoke bun run ward --json session simulate task-five-smoke --task task_d27ef1a1bfa849b8 --summary "Task 005 simulated session completed warm brief and handoff verification." --changes "Added warm cache;Wrote overview brief;Verified handoff" --artifacts "sessions.md"`
- simulated completion writes an `outcome_record`, appends `sessions.md`, and commits `[llm] handoff: <session-id>`
- `ward handoff show <session-id>` returns the same outcome and wiki commit
- `ward brief` reflects one completed session after handoff refresh
- `ward warm` and `ward warm stats` verified; steady-state miss rate stayed at 0 in smoke reads
- direct `GET /api/overview` returns brief counts and recent handoffs
- runtime-served built UI root returns 200 and serves Vite assets with Overview controls
- Overview TTS controls support browser voice selection plus persisted rate and pitch; macOS speech prefers `Joelle (Enhanced)` when available
- `bun run build`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json init`
- fresh Task 006 init creates schema version 5 and applies `0005_plan_packets.sql`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json up`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json create-workspace "Task Six Smoke" --description "Plan mode smoke" --repo /Users/eleazarjunsan/Code/Personal/ward`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json attach task-six-smoke README.md`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json workspace refresh task-six-smoke`
- code-context snapshot captures branch, head commit, bounded file tree, key files, recent commits, and symbols
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json plan start task-six-smoke --prompt "Plan Task 006 smoke validation"`
- Plan Mode completes context, proposal, critique, convergence, and decision rounds with simulated participants
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json plan approve packet_2396233a8ac54f47`
- approved plan writes `wiki/plans/<packet_id>.md` and commits `[llm] plan: approve <packet_id>`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json plan generate-tasks packet_2396233a8ac54f47`
- generated tasks include `task_contract` rows and hard-memory task docs with WARD Metadata, Agent Signals, Implementation Claims, QA Evidence, Harness Critique, and Open Risks
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json plan revise packet_2396233a8ac54f47 "Tighten scope before execution."`
- superseded packet IDs remain readable after revision; new packet is version 2
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json plan start task-six-smoke --prompt "Clarify the planning tradeoff" --clarify`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json plan answer plan_f548fed7e55740b3 "Optimize safety first, then scope."`
- runtime git watcher refreshed a temp linked repo snapshot from head `7106ed001f23f40285a19f7e6976bd8674919f02` to `3401d8079e33852786bf5b3bd0e367cf40dcecbf` after a commit and 3 s wait
- runtime restart verified with `ward down`, `ward up`, and `ward plan status packet_2396233a8ac54f47`

## Done

- [x] `6` Plan Mode and Code-Context Service
  - Doc: [docs/task/006-plan-mode.md](docs/task/006-plan-mode.md)
  - Goal: 5-round Plan Mode with simulated participants; Plan Packet schema and persistence; Code-Context Service (repo snapshot, symbol map).

- [x] `5` Warm-Start Pipeline, Overview, Handoff, and TTS
  - Doc: [docs/task/005-warm-start-overview-handoff.md](docs/task/005-warm-start-overview-handoff.md)
  - Goal: Precompute pipeline; daily brief (structured + narrated); Overview screen; end-of-session handoff writer; browser TTS.

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
