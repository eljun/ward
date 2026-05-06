# TASKS

## Planned

- [ ] `18` Fluid Plasma Orb Shader
  - Doc: [docs/task/018-fluid-plasma-orb-shader.md](docs/task/018-fluid-plasma-orb-shader.md)
  - Goal: Replace the current mesh-and-rings orb with a custom GLSL shader that produces a fluid, atmospheric plasma energy ball comparable to BoltAI's. Vertex displacement with simplex noise, fbm-driven internal currents, Fresnel rim glow, UnrealBloomPass post-processing, four named palettes (Plasma / Aurora / Ember / Quantum), and a Settings dropdown to switch them. Reuses 015's `intensity`, `palette`, and `pulseKey` props plus the `ward:speech` event bus — no call-site changes elsewhere. FPS sampler with a low-fidelity fallback for integrated GPUs. 60 fps on M-series Macs.

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

## Testing

- [ ] `16` Agentic Orb Conductor
  - Doc: [docs/task/016-agentic-orb-conductor.md](docs/task/016-agentic-orb-conductor.md)
  - Goal: Add an action layer on top of the orb chat. The orb classifies messages as chat vs. conductor, plans multi-step actions in a typed JSON schema (`create_task`, `launch_session`, etc.), confirms inline before executing, runs steps through internal handlers, streams `step_started` / `step_completed` SSE events into the transcript, and watches the launched session's lifecycle in-thread until it reaches a terminal state. Reuses task 015's glass aesthetic for the inline confirmation row. Builds on 014 (orb chat stream), 015 (UI shell, palette, inline patterns), and benefits from 017 (configurable chat prompt) — though 017 is recommended, not strictly required.

- [ ] `17` Richer + Configurable Orb Context
  - Doc: [docs/task/017-configurable-orb-context.md](docs/task/017-configurable-orb-context.md)
  - Goal: Stop generic orb replies by including specific state (active workspace name, top open tasks, recent sessions, today's date) in the system prompt, AND expose a Settings card where the user can override the system prompt, toggle which categories are injected, and budget the total token cost. Builds on 014 and 015.

- [ ] `15` Dark Agent-First UI Shell with Live Updates
  - Doc: [docs/task/015-dark-agent-first-ui-shell.md](docs/task/015-dark-agent-first-ui-shell.md)
  - Goal: Replace the light cluttered home with a dark orb-centric shell. Settings becomes a glass modal with Standard / Advanced tabs; agents are grouped by role (Harness 1/2, Orchestrator, Stub) with the local-brain panel folded into the Orchestrator card. Add Cmd+K command palette and Cmd+L launch shortcut. Improve the orb (less Earth-like, plasma palette, atmosphere ring, TTS-reactive pulsing). Make every mutation propagate live without manual page refresh.

- [ ] `14` Conversational Orb Chat with a Local Brain
  - Doc: [docs/task/014-conversational-orb-chat-local-brain.md](docs/task/014-conversational-orb-chat-local-brain.md)
  - Goal: Replace the deterministic regex orb chat with a streaming LLM conversation backed by a local Ollama brain (`gemma4:e2b`); add an OpenAI-compatible streaming adapter, a system prompt that frames WARD as a peer-developer, an SSE stream endpoint, a Settings reachability probe, an explicit-nav escape hatch, and auto text-to-speech on reply.

- Task 014 OpenAI-compatible chat client streams `delta`/`done`/`error` SSE events and probes Ollama via `/api/tags` + `/v1/models` fallback.
- Task 014 `POST /api/orb/chat/stream` returns SSE; nav-intent escape hatch short-circuits without calling the brain.
- Task 014 `GET /api/brains/{id}/probe` reports reachability, latency, and model presence; `POST /api/brains/{id}/test-reply` returns a one-shot completion.
- Task 014 UI orb chat consumes the stream, renders a typing indicator, and auto-speaks via `speechSynthesis` when `profile.tts_enabled`.
- Task 014 Settings adds a Local brain panel with Probe + Test reply buttons and copy-paste guidance for `ollama serve` / `ollama pull gemma4:e2b`.
- Task 014 default `gemma4:e2b` is applied at runtime when `local-openai-compatible.model` is null in existing `brains.yaml`.

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
- `bun run build`
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json init`
- fresh Task 007 init creates schema version 7 and applies `0007_session_lifecycle.sql`
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json up`
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json create-workspace "Task Seven Smoke" --description "Harness launch verification" --repo /Users/eleazarjunsan/Code/Personal/ward`
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json task create task-seven-smoke "Verify stub harness session" --type feature --priority high`
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json session launch task-seven-smoke --task task_fa9ff5e99931425b --scenario default --goal "Run the stub harness smoke"`
- stub harness session reached `done`, wrote `stub-report.md`, persisted `events.ndjson`, and recorded state transitions through initializing, implementing, testing, creating_artifacts, and done
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json session show session_d1a89486a1354e29`
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json sessions --workspace task-seven-smoke`
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json session launch task-seven-smoke --task task_fa9ff5e99931425b --scenario tool-denied --goal "Verify allowlist denial"`
- tool-denied scenario emits `mcp.tool_denied` for fake `shell.exec` while preserving session completion
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json session launch task-seven-smoke --task task_fa9ff5e99931425b --scenario idle-timeout --idle-ms 100 --goal "Verify persisted idle watchdog metadata"`
- idle-timeout scenario emits `watchdog.timeout`, kills the stub worker, and moves the session to `blocked`
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json plan start task-seven-smoke --prompt "Verify sessions ignores plan rows"`
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json sessions --workspace task-seven-smoke` excludes Plan Mode rows and only returns harness-backed sessions
- Task 007 completion slice verified durable queue and per-workspace serial scheduling with a visible session holding the workspace while the next headless session remained queued.
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward session attach session_22615b1e0f254cd0 --input "echo filter ok"` verified visible `node-pty` bridge attach, terminal input, `pty.raw`, and no parser error for PTY echo.
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json session launch task-seven-smoke --scenario qa-missing-evidence` verified `agent.qa_reviewed` and `blocked` lifecycle for missing QA evidence.
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json session launch task-seven-smoke --scenario file-write` plus `ward session revert <session-id>` verified `fs.file_written`, `session.reverted`, and deletion of `.ward-stub-session-output.txt`.
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json session launch task-seven-smoke --scenario default --incognito` verified default session lists exclude incognito rows while `--include-incognito` includes them.
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward session tail <session-id> --duration-ms 250` verified SSE named-event streaming and bounded tail shutdown.
- `WARD_HOME=/tmp/ward-task007-smoke bun run ward --json session launch task-seven-smoke --scenario throughput` persisted 1,200 `worker.message` events and finished `done`.
- Runtime restart recovery verified with `long-running`: interrupted session `session_9fb05273870b4609` recovered as `blocked` with summary, and queued session `session_e69a9b4137214598` dequeued and finished after `ward up`.
- `bun run build`
- `bun install --frozen-lockfile`
- `bun run typecheck`
- `bun run build`
- `git diff --check`
- `bun test` reports no test files in the repo yet
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json init`
- fresh Task 008 init reports schema version 8 and creates the brain registry defaults plus `brains.yaml`
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json brain list`
- brain registry lists `claude-code-cli`, `codex-cli`, `stub-worker`, and disabled `local-openai-compatible` defaults
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json create-workspace "Task Eight Smoke" --description "Brain ledger smoke" --repo /Users/eleazarjunsan/Code/Personal/ward`
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json task create task-eight-smoke "Verify cost ledger" --type feature --priority high`
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json session launch task-eight-smoke --task task_8ed498d9e06d482f --scenario default --goal "Verify cost ledger records stub harness invocation"`
- Task 008 stub harness session reached `done` and recorded one local `stub-worker` cost ledger entry.
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json cost today`
- cost summary reports 1 invocation, 308 ms duration, 0 tokens, and 0 dollars for `stub-worker`
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json quota list --limit 10`
- quota ledger reports `brain.stub-worker.daily_invocations` and `brain.stub-worker.daily_duration_ms`
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json cost forecast`
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json brain disable local-openai-compatible`
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json brain enable local-openai-compatible`
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json brain route recap_and_brief stub-worker`
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json doctor`
- `bun run typecheck`
- `bun run build`
- `git diff --check`
- `bun test` reports no test files in the repo yet
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json doctor`
- Task 008 doctor reports `claude_auth` logged in via `claude.ai` and `codex_auth` logged in using ChatGPT.
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json session launch task-eight-smoke --brain claude-code-cli --mode headless --goal "Adapter smoke only. Do not modify files. Reply with WARD_CLAUDE_ADAPTER_OK and one short sentence." --wall-ms 60000 --idle-ms 15000`
- Claude Code CLI adapter launched headless with subscription auth, streamed JSON events, reached `done`, and captured `WARD_CLAUDE_ADAPTER_OK`.
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json session launch task-eight-smoke --brain codex-cli --mode headless --goal "Adapter smoke only. Do not modify files. Reply with WARD_CODEX_ADAPTER_OK and one short sentence." --wall-ms 90000 --idle-ms 30000`
- Codex CLI adapter launched headless with subscription auth and streamed JSON events; the run hit the current Codex usage limit and WARD classified the session as `blocked`.
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json cost today`
- cost summary records subscription invocations and duration for `claude-code-cli` and `codex-cli`.
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json quota list --limit 10`
- Task 008 session UI shows readable brain choices, state pills, a selected-brain status strip, latest-message summaries, and concise event log payloads for adapter smoke tests.
- Task 008A Command Center orb shell exposes Sessions via the top-left drawer and supporting surfaces through the top-right command menu while preserving existing controls.
- Task 008A runtime-served UI root returns 200 and serves the orb/glassy Vite bundle.
- Task 008B `/api/orb/chat` returns deterministic WARD replies for overview, session, memory, planning, workspace, and settings intents.
- Task 008C Settings backing APIs return Brain Registry, cost forecast, cost summary, quota ledger, and persist brain enable/disable plus route updates.
- Task 008D budget caps persist through `ward brain budget`, cost forecast reports cap limits, over-cap launches fall back to `stub-worker`, and no-fallback over-cap launches reject clearly.
- Task 008E workflow signals persist agent artifacts for task/implement/test, QA Supervisor rejects missing direct evidence, and passes once a matching `test_report` artifact exists.
- Task 009A MCP registry foundation merges global/workspace/repo `.mcp.json` with repo precedence, reports conflicts, redacts scoped/effective output, mutates global/workspace servers, and writes harness overlays from global + workspace scopes.
- Task 009B secrets set/list/unset/rotate works with file fallback, doctor reports the backend, MCP overlays resolve workspace secrets, rotation updates overlays, and workspace unset falls back to global.

## Superseded

- [~] `13` Overview, Workspaces, and Planning UI Refactor
  - Doc: [docs/task/013-overview-workspaces-planning-ui-refactor.md](docs/task/013-overview-workspaces-planning-ui-refactor.md)
  - Superseded by: [Task 015](docs/task/015-dark-agent-first-ui-shell.md). The UI direction shifted to a dark orb-centric shell with a Settings modal and command palette; the surfaces 013 was going to refactor are retired or moved behind the palette.

## Done

- [x] `9` MCP Connections Layer
  - Doc: [docs/task/009-mcp-connections.md](docs/task/009-mcp-connections.md)
  - Goal: Three-scope MCP registry (global / workspace / repo, reuses `.mcp.json`); secrets via OS keychain; tool routing; autonomy-class policy; WARD-as-MCP-server.

- [x] `9G` Settings Connections UI
  - Doc: [docs/task/009g-connections-ui.md](docs/task/009g-connections-ui.md)
  - Goal: Add Settings -> Connections for scoped/effective MCP config, conflicts, server status, tool counts, and safe enable/disable.

- [x] `9F` WARD as a Read-Only MCP Server
  - Doc: [docs/task/009f-ward-mcp-server.md](docs/task/009f-ward-mcp-server.md)
  - Goal: Expose WARD workspaces, sessions, plans, wiki, search, blockers, and status as read-only MCP tools over stdio.

- [x] `9E` MCP Tool Proxy and Circuit Breakers
  - Doc: [docs/task/009e-mcp-tool-proxy-circuit-breakers.md](docs/task/009e-mcp-tool-proxy-circuit-breakers.md)
  - Goal: Dispatch allowed MCP tool calls through WARD policy, emit events, and freeze failing servers through quota-backed circuit breakers.

- [x] `9D` MCP Tool Classification and Autonomy Policy
  - Doc: [docs/task/009d-mcp-tool-classification-autonomy.md](docs/task/009d-mcp-tool-classification-autonomy.md)
  - Goal: Classify MCP tools, apply overrides, expand capability profiles, and enforce autonomy/allowlist decisions before dispatch.

- [x] `9C` MCP Server Lifecycle and Doctor
  - Doc: [docs/task/009c-mcp-server-lifecycle-doctor.md](docs/task/009c-mcp-server-lifecycle-doctor.md)
  - Goal: Verify enabled stdio MCP servers, persist status snapshots, capture stderr logs, and expose `ward mcp doctor`.

- [x] `9B` Secrets and macOS Keychain Fallback
  - Doc: [docs/task/009b-secrets-keychain-fallback.md](docs/task/009b-secrets-keychain-fallback.md)
  - Goal: Add scoped secrets, macOS Keychain default, file fallback, CLI/API surfaces, and MCP overlay secret resolution.

- [x] `9A` MCP Registry Foundation
  - Doc: [docs/task/009a-mcp-registry-foundation.md](docs/task/009a-mcp-registry-foundation.md)
  - Goal: Add scoped `.mcp.json` config, effective merge, redacted API/CLI surfaces, and harness overlay handoff.

- [x] `8` Real Agent Adapters and Cost Ledger
  - Doc: [docs/task/008-real-agent-adapters.md](docs/task/008-real-agent-adapters.md)
  - Goal: Claude Code + Codex CLI adapters, Brain Registry, budget/cost ledger, WARD orb shell, and workflow QA bridge. SDK/API/local execution remains deferred as optional follow-up.

- [x] `8E` Workflow Skills Bridge and QA Supervisor Stub
  - Doc: [docs/task/008e-workflow-skills-qa-supervisor.md](docs/task/008e-workflow-skills-qa-supervisor.md)
  - Goal: Record workflow phase `AgentSignal`s, write evidence packets, and run a deterministic QA Supervisor review.

- [x] `8D` Brain Budget Caps and Fallback
  - Doc: [docs/task/008d-brain-budget-caps-fallback.md](docs/task/008d-brain-budget-caps-fallback.md)
  - Goal: Enforce per-brain daily invocation/dollar caps before launch and fall back through `budget_exceeded_fallback`.

- [x] `8C` Brain Settings and Cost Dashboard
  - Doc: [docs/task/008c-brain-settings-cost-dashboard.md](docs/task/008c-brain-settings-cost-dashboard.md)
  - Goal: Make Brain Registry, routing, cost summary, forecast, and quota ledger visible/editable from Settings.

- [x] `8B` Orb Chat Command Loop
  - Doc: [docs/task/008b-orb-chat-command-loop.md](docs/task/008b-orb-chat-command-loop.md)
  - Goal: Bottom WARD orb chat returns deterministic local replies and opens relevant drawers before real brain routing.

- [x] `8A` Command Center Navigation Layout
  - Doc: [docs/task/008a-command-center-navigation.md](docs/task/008a-command-center-navigation.md)
  - Goal: Centered WARD command-orb home with Sessions drawer, settings/menu drawer, Three.js orb, and Tailwind/shadcn-style UI primitives.

- [x] `7` Harness Abstraction, Lifecycle, and Watchdog
  - Doc: [docs/task/007-harness-lifecycle.md](docs/task/007-harness-lifecycle.md)
  - Goal: Visible PTY and headless harness modes; lifecycle state machine; worker status protocol; watchdog; allowlist enforcement; durable queue; stub worker.

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
