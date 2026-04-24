# Task 001: WARD Tech Plan

- Status: `in_progress`
- Type: `epic` (umbrella tech plan)
- Version Impact: `major`
- Priority: `high`

## Purpose

This task is the **technical plan** for WARD v2. It is not an integration task and
produces no shippable app code. It locks the architecture, contracts, schemas,
and non-functional requirements that every downstream task (002 through 012)
must conform to.

Integration work is broken out into sub-tasks 002 through 012. This document is
the single source of truth those sub-tasks reference.

## What WARD Is

WARD is a local-first, single-user **developer command center and orchestrator**.
One developer runs it on their workstation. It unifies:

- workspace overview and daily recap
- multi-model **Plan Mode** for structured planning
- **agent harnesses** that wrap Codex and Claude Code for real execution
- **wiki-first memory** plus SQLite operational state
- **MCP-based connections** to GitHub, Slack, Vercel, Supabase, and others
- **remote notifications and inbound messaging** when the developer is away
- **learning** through outcomes, preferences, and playbooks

Users interact with WARD through:

- a **CLI** (`ward ...`) that auto-starts the runtime daemon
- a **browser UI** served by the runtime at `127.0.0.1:<port>`
- **remote channels** (Slack primary, Telegram secondary) for chat when away

## Product Boundaries

### In Scope (MVP)

- single-user, local-first runtime
- browser control surface on loopback
- workspace state, attachments, and wiki memory
- daily brief and handoff
- Plan Mode with simulated model adapters (real adapters follow in 008)
- visible (PTY) and headless harness modes
- MCP connections layer with global / workspace / repo scope
- remote outbound alerts and inbound commands when away
- browser-native TTS for greetings and short notifications
- learning loop (outcomes, preferences, routing heuristics)

### Out of Scope (MVP)

- team accounts, org roles, shared permissions
- SaaS multi-tenancy
- production deployment workflows
- fine-tuning
- fully autonomous background execution without approval
- cloud sync / cross-device state sync
- STT (voice input)

## Architecture Summary

WARD is a single long-running **Runtime** (Bun + TypeScript daemon) plus a
browser UI served by that runtime. The Runtime is deterministic code. An
**Orchestrator Brain** (pluggable LLM) is called by the Runtime when prose,
moderation, or reasoning is needed. Third-party integrations are reached
through **MCP servers** spawned or connected to by the Runtime.

### Component Map

```
                +--------------------------------------------------+
                |                    Browser UI                    |
                |   (Vite + lean framework, no SSR, no Next.js)   |
                +--------------------+-----------------------------+
                                     | HTTP / SSE / WebSocket
                                     | (127.0.0.1, device token)
                +--------------------v-----------------------------+
                |                 Runtime (Bun + TS)              |
                |  - HTTP API, SSE event bus, WebSocket PTY mux   |
                |  - Auth, single-instance lock, migrations       |
                |  - Router, queues, watchdogs, cost ledger       |
                |  - Warm-start cache, precompute pipeline        |
                |  - MCP client + server registry                 |
                |  - Inbound listener (Slack Socket Mode)         |
                +---+------------+-----------+-----------+--------+
                    |            |           |           |
             +------v---+  +-----v----+  +---v-----+  +--v--------+
             | SQLite   |  | memory/  |  | Harness |  | Orchestr. |
             | (ops     |  | (wiki,   |  | (PTY +  |  | Brain     |
             | state)   |  | git-     |  | headles |  | (plug-    |
             |          |  | backed)  |  | s)      |  | gable)    |
             +----------+  +----------+  +----+----+  +----+------+
                                              |            |
                                              |            v
                                              |     +------+------+
                                              |     | Brain       |
                                              |     | Registry    |
                                              |     | (CLI / SDK /|
                                              |     | API / local)|
                                              |     +-------------+
                                              |
                                              v
                                       +------+---------+
                                       | MCP Servers    |
                                       | (GitHub, Slack |
                                       | Vercel, Supa., |
                                       | fs, WARD-self) |
                                       +----------------+
```

### High-Level Components

- **Runtime**: Bun + TypeScript daemon. Deterministic. Owns HTTP API, event
  bus, auth, queues, harness lifecycle, MCP client, warm-start cache.
- **Orchestrator Brain**: pluggable LLM invoked by the Runtime for conversational
  output, synthesis, moderation, intent parsing, alert composition. Configured
  via the Brain Registry (see `001/brain-registry.md`).
- **Workspace State**: SQLite database. Operational truth for workspaces,
  tasks, sessions, events, outcomes, preferences, cost ledger.
- **Wiki Memory**: git-backed directory tree under `~/.ward/memory/`. Universal
  wiki plus per-workspace wikis. All LLM edits auto-commit; human edits are
  first-class.
- **Agent Harness**: wraps worker processes (Claude Code CLI, Codex CLI, Agent
  SDK adapters) in visible (PTY) or headless (piped stdio) mode.
- **MCP Client + Registry**: loads, spawns, and routes tool calls across three
  scopes (global / workspace / repo). Reuses Claude Code's `.mcp.json` format
  at the repo scope.
- **Inbound Listener**: Slack Socket Mode connection (primary) for receiving
  remote commands; Telegram long-poll (secondary).
- **Browser UI**: Vite-built SPA served by the Runtime. No Next.js, no SSR
  framework. Dev and prod ship from the same Bun server.

### Process Model

- One long-running daemon per install.
- PID file at `~/.ward/run/ward.pid`; `flock`-based single-instance guard.
- CLI (`ward ...`) auto-starts the daemon if not running, talks to it over
  loopback HTTP with a device token.
- Graceful shutdown: drain in-flight harness events to SQLite, persist warm
  cache to disk, close MCP server subprocesses, release lock.

### Transport

- **HTTP (JSON)** for RPC between CLI / UI and Runtime.
- **SSE** for one-way event streams to the UI (status, notifications, brief
  refreshes).
- **WebSocket** only for PTY byte streams (visible harness mode).
- Default bind: `127.0.0.1` only. LAN or remote access is an explicit opt-in
  via config plus tunneling (see `001/security-model.md`).

## Tech Stack Decisions

### Runtime: Bun + TypeScript

Chosen over Python because WARD is a browser control surface + background
daemon + CLI + event-heavy system, and Bun collapses those into one runtime
and one language. Reasons:

1. One runtime for CLI, daemon, API, and UI eliminates glue stacks.
2. TypeScript + Zod give us compile-time and runtime-checked contracts for the
   many JSON schemas WARD defines (events, plan packets, task contracts,
   harness calls).
3. `bun:sqlite` is first-class, synchronous, fast, zero driver install.
4. Fast CLI cold start (tens of ms) — `ward status` must feel instant.
5. Native HTTP/SSE/WebSocket, native bundler, native test runner.
6. PTY via `node-pty` (native addon, Bun-compatible).
7. Anthropic, OpenAI, and MCP SDKs are production-ready in TypeScript.

Accepted tradeoffs: native-addon compile for PTY, smaller local-LLM ecosystem
than Python (mitigated by OpenAI-compatible local servers like Ollama),
Bun maturity vs Node (mitigated by `node:`-prefixed fallbacks where needed).

### Storage

- **SQLite** for all operational state. Migrations as numbered files
  (`packages/memory/migrations/NNNN_*.sql`) tracked in `schema_version`.
- **Git-backed `memory/`** for wiki pages. On init the memory root is
  auto-`git init`'d. LLM edits commit with `[llm] <type>: <title>`; human edits
  commit with `[user] ...`. Resolves LLM-vs-human conflicts with standard git
  merge tooling and gives free history for free.
- **OS keychain** (via `keytar`-equivalent) for secrets; fallback to
  `~/.ward/secrets/` with mode `0600`.
- **Filesystem** for raw attachments under `~/.ward/attachments/`.

### UI

- Vite + lean SPA (React or Svelte — deferred to 002 scaffolding task).
- No Next.js, no SSR framework.
- Served by the Runtime as static files at `/` with API under `/api`.

### Process Lifecycle

- Auto-start daemon on CLI invocation if not running.
- `ward up` / `ward down` to manage explicitly.
- `ward doctor` verifies: port free, PID lock state, DB schema current, memory
  git repo present, secrets keychain reachable, `claude` and `codex` CLI
  presence and login status, MCP servers spawnable.

## Contracts and Schemas (Appendices)

The following appendix documents under `docs/task/001/` define contracts that
all downstream tasks must honor:

- [`001/brain-registry.md`](001/brain-registry.md) — Brain Registry schema,
  auth modes (subscription / API / local), runtime kinds (CLI / SDK / local),
  capability tags, per-concern routing, cost accounting modes.
- [`001/orchestrator-modes.md`](001/orchestrator-modes.md) — the seven
  Orchestrator Brain modes (Conversational, In-session commentary,
  Intervention, Post-session, Moderator, Alert composer, Silent), autonomy
  levels, presence-aware routing.
- [`001/harness-contract.md`](001/harness-contract.md) — harness launch
  contract, worker status protocol, lifecycle state machine, watchdog rules,
  artifact capture, CLI-wrap vs SDK-wrap vs API-direct runtimes.
- [`001/event-taxonomy.md`](001/event-taxonomy.md) — the canonical event types,
  their payload schemas, and which consumers read which.
- [`001/plan-packet-schema.md`](001/plan-packet-schema.md) — Plan Mode output
  schema, round protocol, and persistence rules.
- [`001/mcp-registry.md`](001/mcp-registry.md) — MCP registry schema, the three
  scopes (global / workspace / repo), reuse of Claude Code's `.mcp.json`,
  secret references, merge and conflict rules.
- [`001/security-model.md`](001/security-model.md) — threat model, auth token,
  bind policy, tunneling options, redaction middleware rules, inbound signing
  verification, destructive-action approval policy.
- [`001/warm-start.md`](001/warm-start.md) — precompute pipeline, cache keys,
  freshness rules, prewarm on daemon start, event-driven refresh,
  response-time SLAs.

## Non-Functional Requirements

These are hard requirements that every sub-task must preserve. Violations are
bugs, not features.

### Performance

- **Conversational response starts streaming in under 500 ms** from user
  submit. Achieved by warm-start pipeline (see `001/warm-start.md`).
- **CLI cold start under 200 ms** for `ward status` and friends.
- **SSE event delivery latency under 100 ms** from emit to UI receipt on
  loopback.

### Scalability (single-user, many workspaces)

- Support **dozens of workspaces** and **hundreds of past sessions** without
  UI regression.
- **Per-workspace serial queue** for harness execution by default; a global
  concurrency cap (preference, default 2) prevents resource thrash.
- Warm cache size bounded (configurable, default 256 MB).

### Security

- Loopback-only bind by default. Remote access requires explicit opt-in and
  tunneling.
- **Uniform device token** required for every API call, including loopback.
- **Redaction middleware** runs before any egress (wiki write, notification,
  model call). Starter rule set in `001/security-model.md`.
- **Secrets never touch SQLite or wiki.** Keychain or `0600` file only,
  referenced by name.
- Inbound remote commands are signed-verified, allowlisted, and audited as
  `session_event`s. Destructive actions require UI approval.

### Observability

- Structured NDJSON logs to `~/.ward/logs/ward-YYYY-MM-DD.log` with daily
  rotation and 30-day retention.
- Per-request trace IDs propagated through Brain calls, MCP calls, and
  harness events.
- `ward doctor` covers the health checks listed above.

### Data Safety

- SQLite schema migrations are forward-only and numbered.
- Git-backed memory gives free history; full `~/.ward/` tar backup is a
  nightly `ward backup` cron (task 012).
- No silent destructive operations. Every destructive path (reset, purge,
  rm) prompts and logs.

### Cost

- **Cost ledger** tracks every Brain call with one of three accounting modes:
  subscription (invocations + duration), api (tokens + $), local (invocations
  only). Daily budget caps per-brain, with fallback routing when exceeded.

### Concurrency

- Per-workspace serial queue on harness runs.
- Global concurrency cap configurable.
- Subscription-provider concurrency caps (e.g., Claude Code session limits)
  respected per-provider in the router.

## Phased Task Breakdown

Each phase is its own task with its own doc under `docs/task/`. Phases are
largely independent but the order respects contract dependencies.

| Task | Scope | Depends on |
|---|---|---|
| **001** | This tech plan (no code) | — |
| **002** | Runtime skeleton: Bun daemon, CLI, auth, migrations, single-instance, logging, `ward doctor`, PTY smoke | 001 |
| **003** | Workspace state + user profile + attachments | 002 |
| **004** | Git-backed wiki memory + conventions + search | 002 |
| **005** | Warm-start precompute + overview + handoff + optional browser TTS | 003, 004 |
| **006** | Plan Mode + code-context service (simulated adapters) | 004, 005 |
| **007** | Harness abstraction: visible + headless + lifecycle state machine + worker status protocol + watchdog | 002, 003 |
| **008** | Real agent adapters: Claude Code CLI wrap + Codex CLI wrap + SDK/API opt-ins + cost ledger | 007 |
| **009** | MCP connections layer: client + three-scope registry + lifecycle + secret injection + WARD-as-MCP-server | 002, 003 |
| **010** | Inbound remote messaging: Slack Socket Mode + Telegram long-poll + signed webhooks + presence-gated alerts + destructive-action UI approval | 009 |
| **011** | Learning loop: outcomes + preferences + routing heuristics + playbooks | 008, 005 |
| **012** | Hardening: backup/restore + cost caps + tunneling guide + observability polish + export | all prior |

Sub-task docs define their own acceptance criteria and scope. This doc does
not re-specify them.

## Acceptance Criteria for Task 001

Task 001 is complete when:

1. This document defines: product boundaries, architecture summary, tech stack
   decisions, storage model, transport model, and non-functional requirements.
2. All eight appendix documents (`brain-registry`, `orchestrator-modes`,
   `harness-contract`, `event-taxonomy`, `plan-packet-schema`, `mcp-registry`,
   `security-model`, `warm-start`) exist and define their contracts.
3. Sub-task docs for 002 through 012 exist with scope and acceptance criteria.
4. `TASKS.md` reflects the new split.
5. `README.md` is updated to remove all Next.js and Python-runtime language.
6. No application code has been written in this task.

## Review Checklist (before starting Task 002)

- [ ] User reviews this document and the eight appendices.
- [ ] User reviews sub-task docs 002 through 012.
- [ ] User confirms stack choice (Bun + TypeScript).
- [ ] User confirms CLI-wrap-first worker harness strategy.
- [ ] User confirms MCP three-scope model including `.mcp.json` reuse.
- [ ] User confirms Slack Socket Mode as primary inbound channel.
- [ ] Any contract disagreement is resolved before 002 begins.
