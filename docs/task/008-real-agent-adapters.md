# Task 008: Real Agent Adapters and Cost Ledger

- Status: `in_progress`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 007

## Summary

Replace stub workers with real Claude Code and Codex CLI adapters using
subscription auth (default). Add Agent SDK and raw API adapters as opt-in
alternatives via Brain Registry. Wire the cost ledger with three accounting
modes (subscription / api / local). Connect real adapters to the
Agent Contract scaffolding from 007 so workflow-skills phases produce
compact signals and hard-memory artifacts.

## In Scope

### CLI adapters

- **Claude Code adapter** (`runtime: cli`, `kind: claude`):
  - Headless: `claude -p "<prompt>" --output-format stream-json`
  - Visible: PTY-spawned `claude` interactive session
  - Stream-json parser maps to WARD events per `001/event-taxonomy.md`
  - Auth: subscription (inherits `~/.claude/` login)
  - Probes login state at launch; emits Intervention if expired
- **Codex adapter** (`runtime: cli`, `kind: codex`):
  - `codex exec` headless mode, equivalent stream parsing
  - Visible PTY mode
  - Auth: subscription

### Workflow-skills bridge

- Map existing agentic workflow skills to WARD agents:
  - `/task` → Planning Agent
  - `/implement` → Coding Agent
  - `/simplify` → Quality Gate Agent
  - `/test` → QA Agent
  - `/document` → Documentation Agent
  - `/ship` → Reporting Agent
  - `/release` → Release playbook input
- Compile `AgentContextPacket` from `TASKS.md`, `docs/task/*.md`, git diff,
  recent events, and relevant wiki pages.
- Require each phase to return `AgentSignal` plus a durable artifact before
  WARD advances.
- Preserve compatibility with externally launched Claude Code / Codex
  sessions observed through `AgentObserver`; WARD may consume their task
  docs and evidence even when it did not launch the session.

### QA Supervisor real runner

- Back QA Supervisor with the configured routing brain, preferring local or
  subscription brains when available to keep QA review inexpensive.
- Compare `/test` evidence against acceptance criteria and implementation
  claims.
- Emit `agent.qa_reviewed` with `pass`, `needs_work`, or `blocked`.
- Update the task evidence packet and `## Harness Critique` when evidence
  is thin.
- Browser automation through Playwright MCP is enabled once the MCP layer
  lands in 009; before then, QA Supervisor reviews existing test artifacts
  and script outputs.

### SDK adapter (opt-in)

- Anthropic Agent SDK adapter (`runtime: sdk`, `kind: anthropic-api`)
- API key resolved via `secret://`
- Disabled by default in Brain Registry

### API adapter (opt-in)

- Direct Anthropic Messages and OpenAI Responses adapters
- Implements minimal agentic loop (tool dispatch, retry on transient
  errors)
- Disabled by default

### Local adapter

- OpenAI-compatible client for Ollama / LM Studio / vLLM
- Used for the cheap-tasks routes (recap, alerts, intent parsing)

### Cost ledger

- Migration `0008_cost_ledger.sql` adds `cost_ledger_entry` table:
  - id, brain_id, accounting_mode, trigger, workspace_id, session_id,
    trace_id, tokens_in, tokens_out, dollars_estimate, duration_ms,
    invocations, created_at
- Per-call recording from every adapter
- Daily roll-up cached at `cost_ledger_today` warm key
- Budget caps in preferences (per-brain `daily_dollar_cap`,
  `daily_invocation_cap`)
- Router consults cap before routing; falls back to
  `budget_exceeded_fallback` when over

### Unified quota ledger

- Migration also adds `quota_ledger` table per [`001/quota.md`](001/quota.md).
- Every brain call writes to `quota_ledger` via the `QuotaPolicy`
  abstraction (not directly to `cost_ledger_entry`).
- `cost_ledger_entry` stays as the domain-shaped table for the Cost UI;
  `quota_ledger` is the generic enforcement substrate used by Quota,
  MCP circuit breakers (009), remote rate limits (010), etc.

### Cost forecasting

- `quota.forecast` events emitted when burn rate projects a soft or hard
  cap breach before the window's reset time.
- UI cost dashboard shows projected breach time per policy.
- CLI: `ward cost forecast` (optionally per-brain).
- Forecast uses a simple linear projection; replace with EWMA later if
  noisy.

### MCP overlay generation

- When launching a worker, generate `~/.ward/sessions/<id>/.mcp.json` with
  resolved global + workspace MCP layers (per `001/mcp-registry.md`)
- Set worker env: `CLAUDE_MCP_CONFIG=<overlay_path>` (or Codex equivalent)
- Worker's working dir = primary repo path → repo `.mcp.json` resolved
  natively
- Overlay deleted on session end

### Vendor login probes

- `ward doctor` checks:
  - `claude --version`, login state via `claude /status`-equivalent
  - `codex --version`, login state via `codex auth`-equivalent
  - Anthropic API key present + ping (only if API brain enabled)
  - OpenAI API key present + ping (only if OpenAI brain enabled)
  - Local endpoint reachable + model listed (only if local brain enabled)

### Routing wiring

- Router from `001/brain-registry.md` becomes live: `routing` map drives
  which brain handles which concern
- Hot-reload on `~/.ward/brains.yaml` change
- `ward brain list` / `ward brain enable` / `ward brain route <concern> <id>`

### UI

- Settings → Brains:
  - Brain list with status, accounting mode, last-used, today's cost or
    invocations
  - Toggle enable/disable
  - Routing matrix editor (concern → brain)
- Cost dashboard:
  - Today's spend per brain (api mode)
  - Today's invocations per brain (subscription / local)
  - Trend (7-day sparkline)
  - Budget cap progress bars

## Out of Scope

- MCP three-scope merger and lifecycle (009)
- Inbound remote messaging (010)
- Learning loop (011)

## Acceptance Criteria

1. Claude Code CLI adapter runs a real coding task headless; events
   stream to UI and persist; subscription auth used (no API key set).
2. Codex CLI adapter runs equivalent task.
3. Visible mode for both: PTY pane works; user can attach.
4. SDK adapter (when enabled with API key) runs the same task.
5. API adapter (when enabled) runs the same task with manual tool-loop.
6. Local adapter runs a recap task on Ollama-backed model.
7. Cost ledger records every brain call; subscription accounting tracks
   invocations + duration; API accounting tracks tokens + dollars.
8. Daily cap exceeded triggers automatic fallback to
   `budget_exceeded_fallback`; logged with reason.
9. Vendor login probes detect missing or expired auth; `ward doctor`
   reports clearly.
10. Stub worker from 007 still works (kept for tests).
11. Workflow-skills bridge runs a simulated `/task -> /implement -> /test`
    chain and produces one `AgentSignal` per phase.
12. QA Supervisor rejects a `/test` PASS when no evidence maps to an
    acceptance criterion, and routes back to Coding Agent or human review.

## Deliverables

- Adapter implementations in `packages/harness/adapters/`
- Cost ledger schema + repository + warm key
- `~/.ward/brains.yaml` loader with hot reload
- `ward brain` CLI subcommands
- Settings → Brains + Cost dashboard

## Risks

- Stream-json format changes upstream: contract tests pin the parser; CI
  runs `claude --version` and `codex --version` to detect drift.
- Subscription concurrency limits: Brain Registry `concurrency_cap` is
  enforced; queue waits when at cap.
- API costs during development: kept disabled by default; CLI adapters are
  the safe path.

## Implementation Notes

### What Changed

- Added the first Task 008 foundation slice: default Brain Registry records,
  brain routes, cost ledger entries, quota ledger rows, and read/update
  surfaces through CLI and runtime API.
- Seeded `~/.ward/brains.yaml` on init/runtime start for user-visible default
  routing configuration.
- Connected completed harness sessions to the cost ledger so the existing
  `stub-worker` records local invocations and duration before real adapters
  are swapped in.

### Files Changed

- `packages/core/src/brains/index.ts` - Brain Registry, cost ledger, quota
  ledger, and forecast schemas.
- `packages/core/src/index.ts` - Exports the new brain/cost/quota contracts.
- `packages/memory/migrations/0008_cost_ledger.sql` - Adds brain registry,
  route, cost ledger, and quota ledger tables.
- `packages/memory/src/brains.ts` - Seeds defaults and exposes registry,
  routing, cost, quota, and forecast repository functions.
- `packages/memory/src/index.ts` - Exports the new memory repository.
- `apps/cli/src/main.ts` - Adds `ward brain`, `ward cost`, and `ward quota`
  commands and seeds the registry during `ward init`.
- `apps/runtime/src/index.ts` - Adds brain/cost/quota API routes, seeds the
  registry at runtime startup, and records harness cost on terminal sessions.
- `TASKS.md` - Moves Task 008 into `In Progress` with the current slice noted.

### Deviations From Plan

- This is an intentional first slice of Task 008. Real Claude Code, Codex,
  SDK/API, local adapter execution, caps, hot reload, and UI dashboards remain
  for subsequent slices.

### Verification Run

- `bun install --frozen-lockfile` - PASS
- `bun run typecheck` - PASS
- `bun run build` - PASS
- `git diff --check` - PASS
- `bun test` - FAIL (no test files exist in the repo yet)
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json init` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json brain list` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json create-workspace "Task Eight Smoke" --description "Brain ledger smoke" --repo /Users/eleazarjunsan/Code/Personal/ward` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json task create task-eight-smoke "Verify cost ledger" --type feature --priority high` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json session launch task-eight-smoke --task task_8ed498d9e06d482f --scenario default --goal "Verify cost ledger records stub harness invocation"` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json session show session_e1f7b53e30154b77` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json cost today` - PASS (1 local `stub-worker` invocation, 308 ms)
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json quota list --limit 10` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json cost forecast` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json brain disable local-openai-compatible` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json brain enable local-openai-compatible` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json brain route recap_and_brief stub-worker` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json doctor` - PASS

### CLI Adapter Slice

#### What Changed

- Added Claude Code and Codex CLI harness adapters behind the existing
  `RunningHarness` contract.
- Added runtime adapter routing: `claude-code-cli` and `codex-cli` now route
  to CLI harnesses when their Brain Registry runtime is `cli`; the 007 stub
  remains the default and fallback for local/simulated brains.
- Added vendor login probes to `ward doctor` for `claude auth status` and
  `codex login status`.
- Added `ward session launch --brain <brain-id> --runtime <kind>` support,
  with runtime inferred from the selected brain by default.
- Added UI brain selection for session launches, defaulting to `stub-worker`
  to avoid accidental real-agent runs.
- Added stream parsers that map Claude/Codex JSONL output, lifecycle markers,
  tool calls, errors, and provider metadata into WARD session events while
  preserving raw output in `pty.raw`.
- Classified provider/auth/quota failures as `blocked` instead of generic
  implementation failures.

#### Files Changed

- `packages/harness/src/index.ts` - Adds Claude/Codex CLI adapters, probes,
  prompt building, stream parsing, status marker parsing, watchdog handling,
  and provider-limit classification.
- `packages/memory/src/sessions.ts` - Validates selected brains, infers
  runtime from Brain Registry, and writes a CLI-safe MCP overlay envelope.
- `apps/runtime/src/index.ts` - Routes launched sessions to the selected
  harness adapter and records generic harness summaries/costs.
- `apps/cli/src/main.ts` - Adds CLI brain/runtime flags and login checks in
  `ward doctor`.
- `apps/ui/src/main.tsx` - Adds enabled-brain selection in the session launch
  UI and subscribes to CLI-specific event types.

#### Deviations From Plan

- Kept API adapters out of this slice. Normal Claude/Codex CLI is the phase-1
  path because it uses existing subscription auth and avoids early API key
  and billing complexity.
- Codex real-run success could not be completed because the account hit its
  current usage limit during smoke verification. The adapter did launch,
  stream JSON, persist events, and classify the provider limit as `blocked`.

#### Verification Run

- `bun run typecheck` - PASS
- `bun run build` - PASS
- `git diff --check` - PASS
- `bun test` - FAIL (no test files exist in the repo yet)
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json doctor` - PASS
  (`claude_auth` logged in via `claude.ai`; `codex_auth` logged in using
  ChatGPT)
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json session launch task-eight-smoke --brain claude-code-cli --mode headless --goal "Adapter smoke only. Do not modify files. Reply with WARD_CLAUDE_ADAPTER_OK and one short sentence." --wall-ms 60000 --idle-ms 15000` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json session show session_4559bc1f571844f9` - PASS (`done`, captured `WARD_CLAUDE_ADAPTER_OK`)
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json session launch task-eight-smoke --brain codex-cli --mode headless --goal "Adapter smoke only. Do not modify files. Reply with WARD_CODEX_ADAPTER_OK and one short sentence." --wall-ms 90000 --idle-ms 30000` - PARTIAL
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json session show session_65ea1b06b7004cca` - PASS for WARD behavior (`blocked`, provider usage-limit error captured)
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json cost today` - PASS (subscription invocations/duration recorded for Claude and Codex)
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json quota list --limit 10` - PASS
