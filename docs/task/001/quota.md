# Appendix: Quota and Rate Limiting

Quota is the cross-cutting concern that says "you are approaching a limit
and here's what to do about it". It applies at four boundaries in WARD:

1. **Brain cost caps** — per-brain $ / invocation / duration ceilings
2. **Subscription concurrency** — vendor-imposed concurrent-session caps
3. **Remote command rate limits** — per-user / per-channel inbound caps
4. **MCP circuit-breaking** — per-server failure-rate caps

Putting all four in one layer keeps the patterns (measurement, warning,
enforcement, fallback, audit) consistent — and means the next quota
domain added later is a config job, not a new subsystem.

## Unified Quota Model

Every quota follows the same shape:

```ts
type QuotaPolicy = {
  id: string;                   // "brain.claude-code-cli.daily_invocations"
  scope: "global" | "brain" | "workspace" | "channel" | "mcp_server" | "user";
  target: string;               // e.g. brain id, channel id, slack user id
  metric: "invocations" | "tokens" | "dollars" | "duration_ms" | "failures" | "requests";
  window: "second" | "minute" | "hour" | "day" | "week" | "rolling:<N>s";

  soft_limit?: number;          // triggers warning, no block
  hard_limit: number;           // triggers block / fallback
  burst_limit?: number;         // short-window spike cap

  on_soft?: QuotaAction[];      // "notify", "forecast", "log"
  on_hard: QuotaAction[];       // "deny", "fallback:<brain_id>", "queue", "notify", "freeze"

  reset: "rolling" | "fixed_window";
  reset_at?: "midnight_local_tz" | "fixed:<cron>" | "never";

  enabled: boolean;
};
```

All quota state lives in a single `quota_ledger` SQLite table with
`(policy_id, window_start, count)` so the implementation is one
repository, not four.

## Domain Mappings

### Brain cost caps (Task 008)

```yaml
- id: brain.claude-code-cli.daily_invocations
  scope: brain
  target: claude-code-cli
  metric: invocations
  window: day
  soft_limit: 400
  hard_limit: 500
  on_soft: [notify, forecast]
  on_hard: [fallback:local-qwen, notify]
  reset_at: midnight_local_tz

- id: brain.claude-api.daily_dollars
  scope: brain
  target: claude-api
  metric: dollars
  window: day
  soft_limit: 8.00
  hard_limit: 10.00
  on_soft: [notify, forecast]
  on_hard: [fallback:claude-code-cli, notify]
```

### Subscription concurrency (Task 008)

```yaml
- id: subscription.claude.concurrent
  scope: brain
  target: claude-code-cli
  metric: invocations    # current-in-flight
  window: rolling:0s
  hard_limit: 2          # Brain Registry concurrency_cap
  on_hard: [queue]
```

### Remote command rate (Task 010)

```yaml
- id: remote.slack.per-user
  scope: user
  target: "*"            # wildcards allowed; per-user bucket created on first seen
  metric: requests
  window: rolling:300s
  hard_limit: 30
  burst_limit: 5         # over 10s
  on_hard: [deny, notify]
```

### MCP circuit breaker (Task 009)

```yaml
- id: mcp.server.failure_rate
  scope: mcp_server
  target: "*"
  metric: failures
  window: rolling:60s
  hard_limit: 5
  on_hard: [freeze:60s, notify]
```

## Forecasting

When a `soft_limit` is crossed or the ledger detects an unusually steep
burn curve, the Quota layer can emit a **forecast event**:

```
quota.forecast: claude-code-cli will hit daily cap at ~15:40 local-tz
                at current rate (7h invocation run-rate: 63/hr)
```

UI renders as a non-blocking toast; away-user gets an Alert-composer
message if priority is configured. Forecasts are purely advisory —
enforcement is still event-driven at hard limits.

## Freeze Action

`on_hard: [freeze:<duration>]` temporarily disables a target. Used for:

- MCP server with repeated failures (circuit breaker open 60 s)
- Brain that keeps returning malformed JSON (freeze 5 min, fallback
  routes)
- Remote user exhibiting anomalous behavior (freeze until manual unfreeze)

Freeze state is surfaced in `ward doctor` and in the UI. Manual unfreeze
via CLI (`ward quota unfreeze <policy_id>`) or UI.

## Events

Quota-layer events (per `001/event-taxonomy.md`):

- `quota.soft_exceeded` — soft limit crossed
- `quota.hard_exceeded` — hard limit crossed
- `quota.forecast` — projected breach
- `quota.fallback_routed` — enforcement routed via fallback
- `quota.frozen` / `quota.unfrozen`
- `quota.denied` — request denied

These feed cost-ledger and observability dashboards.

## CLI + UI

```
ward quota list
ward quota show <policy_id>
ward quota set <policy_id> --hard-limit ... --soft-limit ...
ward quota unfreeze <policy_id>
ward quota forecast                # per-policy burn projections
```

UI: Settings → Quotas

- Per-policy progress bars
- Burn-rate sparklines
- "Freeze brain X" emergency button
- Forecast warnings
- Audit log of quota events

## Testing

- Fuzz test: random request streams never drive the ledger into
  inconsistent state.
- Wall-clock safety: reset_at logic handles DST and timezone changes.
- Fallback chains: every `hard` action with a `fallback:` target must
  reference an enabled brain; CI lint enforces.
- Freeze idempotency: double-freeze / double-unfreeze is safe.

## Task Mapping

The quota layer is built incrementally, not as one task:

| Domain | Lands in |
|---|---|
| Brain cost caps (api accounting) | 008 |
| Subscription concurrency | 008 |
| Remote command rate limiting | 010 |
| MCP circuit breakers | 009 |
| Forecasting + UI Quotas panel | 012 |
| Unified `quota_ledger` table + repository | 008 (earliest consumer) |

Task 008 creates the unified table; later tasks add policy rows for
their domains. Because every domain uses the same table and repository,
the UI built in 012 shows all quotas automatically.
