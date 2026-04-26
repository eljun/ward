# TASKS

## Planned

- [ ] `2` Runtime Skeleton
  - Doc: [docs/task/002-runtime-skeleton.md](docs/task/002-runtime-skeleton.md)
  - Goal: Bun + TypeScript monorepo, daemon + CLI, auth, single-instance, migrations, structured logging, `ward doctor`, PTY smoke.

- [ ] `3` Workspace State, User Profile, and Attachments
  - Doc: [docs/task/003-workspace-state.md](docs/task/003-workspace-state.md)
  - Goal: SQLite schema for workspaces, tasks, sessions, events, preferences; user profile; attachment intake (markdown / text / PDF).

- [ ] `4` Git-Backed Wiki Memory
  - Doc: [docs/task/004-wiki-memory.md](docs/task/004-wiki-memory.md)
  - Goal: Universal + per-workspace wikis backed by git; conventions; FTS5 search across wiki, sessions, plan packets; lint pass.

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

- None

## Done

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
