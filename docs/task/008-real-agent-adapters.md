# Task 008: Real Agent Adapters and Cost Ledger

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 007

## Summary

Replace stub workers with real Claude Code and Codex CLI adapters using
subscription auth (default). Add Agent SDK and raw API adapters as opt-in
alternatives via Brain Registry. Wire the cost ledger with three accounting
modes (subscription / api / local).

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
