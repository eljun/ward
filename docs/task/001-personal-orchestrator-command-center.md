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

WARD is organized as **ten layers** plus five **cross-cutting concerns**.
Each layer exposes stable contracts (see `001/extension-seams.md`); the
cross-cutting concerns weave through multiple layers and are enforced
uniformly.

The top-level process is a long-running **Runtime** daemon (Bun + TypeScript)
that hosts the layers and serves a browser UI on loopback. The Runtime
layer is pure plumbing; the **Orchestration** layer is the conductor that
chooses modes, routes brains, assembles context, and gates autonomy — the
two used to be conflated and are now explicitly split.

### Architecture Layers

```
  ┌──────────────────────────────────────────────────────────────┐
  │  UI                   (browser SPA + CLI; consumers only)     │
  ├──────────────────────────────────────────────────────────────┤
  │  Orchestration        mode selection · context packet · intent │
  │                       parsing · autonomy gates · Plan Mode     │
  │                       engine · presence service                │
  ├──────────────────────────────────────────────────────────────┤
  │  Learning  │  Scheduling  │  Communication  │  Brain  │ Harness│
  │  outcomes  │  triggers +  │  channels +     │  LLMs + │ workers│
  │  inferrer  │  playbooks   │  inbound/out    │  routing│        │
  ├──────────────────────────────────────────────────────────────┤
  │  Connection (MCP)     three-scope registry · lifecycle ·      │
  │                       tool routing · secret injection          │
  ├──────────────────────────────────────────────────────────────┤
  │  Persistence          SQLite ops state · git-backed memory ·  │
  │                       attachments · warm cache                 │
  ├──────────────────────────────────────────────────────────────┤
  │  Runtime              daemon · HTTP/SSE/WS · event bus · queue │
  │                       primitive · single-instance · migrations │
  │                       · structured logs                        │
  └──────────────────────────────────────────────────────────────┘

   Cross-cutting:  Security   Observability   Identity
                   Config     Quota
```

### Layer Responsibilities

| Layer | Owns | Extension seam(s) |
|---|---|---|
| **Runtime** | process, HTTP/SSE/WS, event bus, queue primitive, single-instance lock, migrations, structured logs | — (plumbing) |
| **Persistence** | SQLite operational state, git-backed memory, attachments, warm cache | `MemoryBackend`, `SearchBackend`, `CacheBackend`, `AttachmentIngestor` |
| **Connection (MCP)** | three-scope MCP registry (global / workspace / repo), server lifecycle, tool routing + allowlist, secret injection, WARD-as-MCP-server | MCP protocol; `ConnectorAdapter` fallback |
| **Brain** | pluggable LLMs, Brain Registry, per-concern routing, cost accounting | `BrainAdapter` |
| **Harness** | worker runtime adapters (CLI / SDK / API / local / simulated), lifecycle state machine, watchdog, artifact capture | `HarnessAdapter` |
| **Communication** | remote channels, inbound listener, outbound composer, rate limiting, audit | `RemoteChannel` |
| **Scheduling** | unified trigger registry (cron, git, PR, CI, file, presence, inbound, webhook), playbook engine | `TriggerSource` |
| **Learning** | outcome capture, inference engines, routing advisor, playbook miner — all shadow-then-confirm | `Inferrer` |
| **Orchestration** | context packet assembly, mode selection, intent parsing, autonomy gates, Plan Mode engine, presence service — the conductor | `AutonomyPolicy` |
| **UI** | browser SPA (Vite) + CLI — consumers of the Runtime API | — |

### Cross-Cutting Concerns

| Concern | Spans | Anchor doc |
|---|---|---|
| **Security** | auth, secrets, redaction, tool allowlists, destructive-action gating | `001/security-model.md` |
| **Observability** | logs, traces, metrics, audit, `ward doctor` | 001 NFRs + 012 |
| **Identity** | user profile, external identities per channel, sender allowlists | `001/security-model.md` (Identity section) |
| **Config** | scope-resolved preferences (global / workspace / repo), hot reload | `001/brain-registry.md` + `001/mcp-registry.md` |
| **Quota** | cost caps, subscription concurrency, remote rate limits, MCP circuit breakers | `001/quota.md` |

### Layer Enforcement

A dependency lint in CI (from Task 002) forbids cross-layer imports that
bypass the declared contracts. Details in `001/extension-seams.md`
("Enforcing Layering"). Without this, the layers are decorative; with it,
they're real.

### Control Flow (example)

A user asks "delegate project-y backfill to Claude":

1. **UI** posts to Runtime → `/api/conversation`.
2. **Runtime** validates device token, emits `user.message`, forwards to **Orchestration**.
3. **Orchestration** runs a classifier → Action mode. Calls **Brain** via Brain Registry for intent parsing.
4. **Orchestration** resolves the parsed action (`delegate`, workspace `project-y`, worker `claude`), consults **Config** (autonomy for project-y = strict) and **Quota** (is Claude cap reached? no).
5. **Orchestration** asks **Harness** to launch a session. Harness picks the adapter by `runtime_kind` (claude-code-cli), pulls warm context from **Persistence** (`context_packet:project-y`), writes the MCP overlay from **Connection**, spawns the worker.
6. Worker emits events → **Harness** normalizes → **Runtime** event bus → fanout to **Persistence** (SQLite), **UI** (SSE), **Learning** (outcome ingest), **Communication** (alert if presence=away).
7. A tool call arrives → **Connection** proxy checks allowlist against **AutonomyPolicy** → if gated, emits Intervention → **Orchestration** routes to UI or **Communication** based on **Identity** + presence.
8. Everything flows through **Security** redaction before egress and **Observability** logs with a shared trace id.

This is the recurring pattern: layers talk through contracts, Orchestration conducts, cross-cutting concerns apply uniformly.

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

- [`001/extension-seams.md`](001/extension-seams.md) — the named interfaces
  for every pluggable layer (`BrainAdapter`, `MemoryBackend`, `SearchBackend`,
  `CacheBackend`, `HarnessAdapter`, `ConnectorAdapter`, `RemoteChannel`,
  `TriggerSource`, `AttachmentIngestor`, `Inferrer`, `AutonomyPolicy`,
  `RedactionRule`). Enforcement via CI dependency lint.
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
  schema, round protocol, `convergence_policy` (consensus / coordinator /
  user), persistence rules.
- [`001/mcp-registry.md`](001/mcp-registry.md) — MCP registry schema, the three
  scopes (global / workspace / repo), reuse of Claude Code's `.mcp.json`,
  secret references, merge and conflict rules.
- [`001/security-model.md`](001/security-model.md) — threat model, auth token,
  bind policy, tunneling options, redaction middleware rules, **Identity**
  (user profile + external identities + allowlists), inbound signing
  verification, destructive-action approval policy.
- [`001/quota.md`](001/quota.md) — unified quota model covering brain cost
  caps, subscription concurrency, remote rate limits, MCP circuit breakers,
  forecasting, freeze actions.
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

1. This document defines: product boundaries, architecture layers and
   cross-cutting concerns, tech stack decisions, storage model, transport
   model, and non-functional requirements.
2. All ten appendix documents (`extension-seams`, `brain-registry`,
   `orchestrator-modes`, `harness-contract`, `event-taxonomy`,
   `plan-packet-schema`, `mcp-registry`, `security-model`, `quota`,
   `warm-start`) exist and define their contracts.
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
