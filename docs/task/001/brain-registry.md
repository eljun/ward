# Appendix: Brain Registry

The Brain Registry is the configuration of all LLMs available to the WARD
Runtime. It is pluggable, per-install, and covers three distinct LLM surfaces
with different defaults and accounting modes.

## LLM Surfaces

WARD invokes LLMs in three places; each has different concerns:

| Surface | Role | Default runtime | Default auth |
|---|---|---|---|
| **Worker harness** | Writes code in a repo (Claude Code, Codex) | CLI wrap | subscription |
| **Orchestrator Brain** | Chat, synthesis, moderation, intent parsing, alert writing | CLI wrap or API (per config) | subscription or api_key |
| **Plan Mode participants** | Debating voices in plan rounds | mixed | mixed |

Key principle: **use the subscription-authenticated CLI where it exists.**
Agent SDKs and raw APIs are available as opt-in alternatives for users who
need them or for brains without a CLI (e.g., local LLMs, GPT).

## Registry Schema

Stored in `~/.ward/brains.yaml` (or equivalent JSON). Shape:

```yaml
brains:
  - id: <string, unique>
    kind: claude | codex | openai | openai-compatible | anthropic-api | google | xai | local
    runtime: cli | sdk | api | local
    auth: subscription | api_key | none
    model: <model identifier>
    base_url: <optional, for openai-compatible endpoints>
    secret: <optional, e.g. "secret://anthropic-api-key">
    env: <optional map of env vars for CLI/SDK>
    tags: [reasoning, worker, moderator, fast, private, cheap, offline, challenger, alternative]
    capabilities:
      tool_use: true | false
      streaming: true | false
      json_mode: true | false
      max_context: <tokens>
    concurrency_cap: <int, default 1>
    enabled: true | false
    accounting: subscription | api | local

routing:
  default: <brain id>
  orchestrator_brain: <brain id>
  plan_mode_moderator: <brain id>
  plan_mode_participants: [<brain ids>]
  recap_and_brief: <brain id>
  alert_composer: <brain id>
  intent_parser: <brain id>
  diff_summarizer: <brain id>
  privacy_sensitive: <brain id with private tag>
  budget_exceeded_fallback: <brain id>
```

## Example Registry

```yaml
brains:
  - id: claude-code-cli
    kind: claude
    runtime: cli
    auth: subscription
    model: claude-opus-4-7
    tags: [reasoning, worker, moderator]
    capabilities: { tool_use: true, streaming: true, json_mode: true }
    concurrency_cap: 2
    enabled: true
    accounting: subscription

  - id: codex-cli
    kind: codex
    runtime: cli
    auth: subscription
    tags: [worker]
    capabilities: { tool_use: true, streaming: true, json_mode: true }
    concurrency_cap: 2
    enabled: true
    accounting: subscription

  - id: claude-api
    kind: anthropic-api
    runtime: sdk
    auth: api_key
    secret: secret://anthropic-api-key
    model: claude-opus-4-7
    tags: [reasoning, worker]
    capabilities: { tool_use: true, streaming: true, json_mode: true }
    enabled: false
    accounting: api

  - id: gpt-5
    kind: openai
    runtime: api
    auth: api_key
    secret: secret://openai-api-key
    model: gpt-5
    tags: [reasoning, alternative, challenger]
    capabilities: { tool_use: true, streaming: true, json_mode: true }
    enabled: false
    accounting: api

  - id: local-qwen
    kind: openai-compatible
    runtime: local
    auth: none
    base_url: http://127.0.0.1:11434/v1
    model: qwen2.5:14b
    tags: [fast, private, cheap, offline]
    capabilities: { tool_use: true, streaming: true, json_mode: true, max_context: 32768 }
    enabled: true
    accounting: local

routing:
  default: claude-code-cli
  orchestrator_brain: claude-code-cli
  plan_mode_moderator: claude-code-cli
  plan_mode_participants: [claude-code-cli, local-qwen]
  recap_and_brief: local-qwen
  alert_composer: local-qwen
  intent_parser: local-qwen
  diff_summarizer: local-qwen
  privacy_sensitive: local-qwen
  budget_exceeded_fallback: local-qwen
```

## Runtime Kinds

- **`cli`** — spawn the vendor CLI as a subprocess. Headless: pipe stdio and
  parse `--output-format stream-json`. Visible: wrap in PTY. Uses existing
  CLI auth (subscription). Examples: `claude`, `codex`.
- **`sdk`** — call the vendor's Agent SDK in-process. API-keyed. Examples:
  `@anthropic-ai/claude-agent-sdk`, OpenAI SDK with agents.
- **`api`** — direct HTTP API calls (Anthropic Messages, OpenAI Responses).
  Lowest level.
- **`local`** — OpenAI-compatible local HTTP endpoint (Ollama, LM Studio,
  vLLM, llama.cpp's server). No auth by default; token optional.

## Auth Modes

- **`subscription`** — inherit from the CLI's existing login. Runtime never
  sees the credential; it spawns the CLI which reads its own auth store.
- **`api_key`** — referenced by name via `secret://<name>`. Resolved from OS
  keychain at call time. Never persisted in logs, SQLite, or wiki.
- **`none`** — local endpoints without auth.

## Capability Tags

Tags are free-form and used by routing rules. Suggested vocabulary:

- `reasoning` — use for hard synthesis and moderation
- `worker` — suitable as a harness worker
- `moderator` — suitable as Plan Mode moderator
- `fast` — low latency, use for recaps / alerts
- `cheap` — low cost per call (local or small model)
- `private` — runs locally, no egress (used for `privacy_sensitive` routing)
- `offline` — works without network
- `challenger` / `alternative` — Plan Mode diversity picks

## Capabilities (hard)

Populated explicitly per brain. Router uses these to refuse incompatible
routes: e.g., if `intent_parser` requires `json_mode: true` and the chosen
brain doesn't have it, fall back to `budget_exceeded_fallback`.

## Routing Rules

Router picks a brain per-concern, not per-call. Resolution order:

1. Explicit per-concern binding in `routing:`.
2. If the binding's brain is disabled or unhealthy, use
   `budget_exceeded_fallback`.
3. If content carries a `privacy_sensitive` tag, force-route to
   `privacy_sensitive`.
4. If daily cost cap exceeded for the bound brain, route to
   `budget_exceeded_fallback`.

All routing decisions are logged with the trace ID and reason.

## Cost Ledger Accounting Modes

| Accounting | Tracked | Budget cap mechanism |
|---|---|---|
| `subscription` | invocation count + wall-clock duration + concurrent slots used | soft warning at vendor-published fair-use thresholds; concurrency cap from `concurrency_cap` |
| `api` | input tokens + output tokens + $ estimate | hard daily $ cap in preferences; router falls back when exceeded |
| `local` | invocation count + latency | no $; optional rate cap |

Ledger entries carry: `brain_id`, `mode`, `trigger` (user / harness /
inbound_slack / scheduled), `tokens_in`, `tokens_out`, `dollars_estimate`,
`duration_ms`, `trace_id`, `workspace_id`.

## Health Checks

`ward doctor` verifies, per enabled brain:

- CLI brains: binary present on PATH, minimum version, logged-in state
- SDK/API brains: secret resolvable, test ping succeeds
- Local brains: base URL reachable, model listed in `/v1/models`

## Changing the Registry

- Editable via `~/.ward/brains.yaml` directly.
- CLI: `ward brain list`, `ward brain enable <id>`, `ward brain route <concern> <id>`.
- UI: Settings → Brains, with inline health status and last-used metrics.

Any registry change is hot-reloaded by the Runtime without restart.
