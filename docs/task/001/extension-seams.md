# Appendix: Extension Seams

WARD is designed to grow without refactoring. Each layer exposes one or
more **stable interfaces** that new implementations plug into. New
providers, new memory backends, new channels, new triggers, new worker
runtimes — all become "write one file + register it" operations, not
cross-cutting rewrites.

This document is the single index of every extension seam in WARD. If a
capability doesn't fit one of these seams, either the seam needs to
evolve (via a versioned contract change) or the feature is a consumer,
not a seam (see "Integrations vs. Seams" at the bottom).

## Seam Catalog

| Seam | Layer | Purpose | Registered in |
|---|---|---|---|
| `BrainAdapter` | Brain | pluggable LLM backend (CLI / SDK / API / local) | `~/.ward/brains.yaml` |
| `MemoryBackend` | Persistence | how compiled memory is stored + searched | runtime config |
| `SearchBackend` | Persistence | how full-text / semantic search is answered | runtime config |
| `CacheBackend` | Persistence | warm-cache storage (in-memory LRU, disk snapshot, future Redis) | runtime config |
| `HarnessAdapter` | Harness | how a worker is launched and observed | per-brain `runtime_kind` in Brain Registry |
| `ConnectorAdapter` | Connection | non-MCP integrations (fallback; MCP is the default seam) | runtime config |
| `RemoteChannel` | Communication | inbound + outbound message carrier | `~/.ward/channels.yaml` |
| `AgentObserver` | Communication | observe coding agents WARD didn't launch (Claude Code, Codex, Cursor, Aider, …) | built-in list + registry |
| `TriggerSource` | Scheduling | what can fire a playbook or a session | built-in list + registry |
| `AttachmentIngestor` | Persistence | how an attachment kind becomes extractable text | kind → ingestor registry |
| `Inferrer` | Learning | domain-specific inference (preferences, routing, playbooks) | built-in list + registry |
| `AutonomyPolicy` | Orchestration | custom autonomy rules beyond the default matrix | preference override |
| `AgentRegistry` | Orchestration | discover bounded specialist agents and their contracts | built-in list + plugin registry |
| `RedactionRule` | Security (cross-cut) | custom redaction patterns | preferences |

## Contracts

All interfaces are defined in `packages/core/contracts/`. Every
implementation ships with contract tests that validate it against fixtures.
Contract drift is caught at CI time, not production.

### BrainAdapter

```ts
interface BrainAdapter {
  readonly kind: string;                     // "claude", "codex", "openai", "anthropic-api", "openai-compatible", "simulated", ...
  readonly runtimeKind: "cli" | "sdk" | "api" | "local";

  probe(): Promise<HealthStatus>;            // login state, ping, cli presence
  capabilities(): BrainCapabilities;         // tool_use, streaming, json_mode, max_context
  accounting(): "subscription" | "api" | "local";

  invoke(call: BrainCall): AsyncIterable<BrainEvent>;   // normalized event stream
  cancel(callId: string): Promise<void>;
}
```

`BrainCall` carries mode, prompt, tools available, context packet, trace id.
`BrainEvent` is the normalized stream (message delta, tool call, tool
result, thinking, status, usage, done).

### MemoryBackend

```ts
interface MemoryBackend {
  read(scope: Scope, page: string): Promise<MemoryPage>;
  write(scope: Scope, page: string, body: string, author: "user" | "llm"): Promise<void>;
  append(scope: Scope, page: string, section: string, author: "user" | "llm"): Promise<void>;
  history(scope: Scope, page: string): Promise<MemoryCommit[]>;
  snapshot(out: string): Promise<void>;      // used by 012 backup
}
```

Default impl: `GitBackedLocalMemory`. Future: `ClaudeManagedMemory`,
`HybridMemory` (local primary, cloud mirror).

### SearchBackend

```ts
interface SearchBackend {
  index(doc: SearchableDoc): Promise<void>;
  indexBatch(docs: SearchableDoc[]): Promise<void>;
  query(q: string, opts: { scope?: Scope; limit?: number }): Promise<SearchHit[]>;
  rebuild(): Promise<void>;
}
```

Default impl: `SqliteFts5`. Future: `VectorBackend` (embeddings-based).

### CacheBackend

```ts
interface CacheBackend {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, opts?: { ttlMs?: number }): Promise<void>;
  invalidate(key: string | string[]): Promise<void>;
  snapshot(out: string): Promise<void>;      // persist on shutdown
  restore(from: string): Promise<void>;
}
```

Default impl: `LruDiskSnapshotCache`.

### HarnessAdapter

```ts
interface HarnessAdapter {
  readonly kind: "claude" | "codex" | "anthropic-api" | "openai-api" | "simulated" | string;
  readonly runtimeKind: "cli" | "sdk" | "api" | "local";

  launch(input: HarnessLaunch): Promise<RunningHarness>;
}

interface RunningHarness {
  readonly sessionId: string;
  events(): AsyncIterable<WardEvent>;        // normalized event stream
  cancel(): Promise<void>;
  answerIntervention(decision: InterventionDecision): Promise<void>;
  attachPty?(ws: WebSocket): Promise<void>;  // visible mode only
}
```

### ConnectorAdapter (non-MCP fallback)

MCP is the preferred seam for third-party connections. For integrations
that have no MCP server (rare now), a `ConnectorAdapter` provides the
same tool-call shape so callers don't know the difference.

```ts
interface ConnectorAdapter {
  readonly id: string;
  tools(): Tool[];
  invoke(tool: string, args: unknown): Promise<unknown>;
  health(): Promise<HealthStatus>;
}
```

### RemoteChannel

```ts
interface RemoteChannel {
  readonly id: string;
  readonly kind: "slack" | "telegram" | "email" | "discord" | "signal" | string;

  start(): Promise<void>;
  stop(): Promise<void>;

  send(msg: OutboundMessage): Promise<SendResult>;
  onMessage(handler: (m: InboundMessage) => void): Unsubscribe;

  verifySignature(raw: Buffer, headers: Record<string, string>): boolean;
  formatIntervention(i: Intervention): OutboundMessage;
  parseAction(payload: unknown): InteractionAction | null;
}
```

Adding a new carrier (Discord, Signal, iMessage) = one file implementing
this interface + one registry entry. Rate limiter, allowlist, audit log
are channel-agnostic and inherited.

### AgentObserver

WARD only sees the full event stream of workers it launches itself. But you
will run `claude`, `codex`, and other coding agents directly all day, outside
of WARD. `AgentObserver` is the seam that lets WARD observe those external
sessions so the peer stays contextually aware regardless of who launched the
agent.

```ts
interface AgentObserver {
  readonly id: string;
  readonly agent: "claude-code" | "codex" | "cursor" | "aider" | "continue" | "opencode" | string;

  start(bus: EventBus): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<HealthStatus>;
}
```

Observers translate vendor-native signals into a normalized event family
(`external_agent.session_started`, `external_agent.message_sent`,
`external_agent.tool_invoked`, `external_agent.session_ended`) and feed
them into the same event bus that WARD-launched sessions use. The
Orchestrator's Conversational and Post-session modes consume them through
the existing paths.

Per-vendor observation surfaces:

| Agent | Native surface used by observer |
|---|---|
| Claude Code | `Stop` / `Notification` / `PostToolUse` / `UserPromptSubmit` hooks installed in `~/.claude/hooks.d/`, plus tail of `~/.claude/projects/<hash>/<session>.jsonl` |
| Codex | tail of `~/.codex/sessions/<id>/` rollout files |
| Aider | `chokidar`-watch of `.aider.chat.history.md` in known repo paths |
| Cursor | tiny VS Code extension (post-MVP) talking to WARD over loopback |
| Continue / OpenCode | each ships an observer reading its own session format |

Companion: outgoing context flows the other way through
**WARD-as-MCP-server** (see `mcp-registry.md`) — any MCP-aware agent can
pull WARD's wiki, blockers, brief, and plan packets via tool calls. The
two together form a bidirectional context loop: WARD observes the agent;
the agent reads WARD's memory.

Shipped impls in 011: `ClaudeCodeObserver`, `CodexObserver`. Others
plug in later without touching downstream consumers.

### TriggerSource

```ts
interface TriggerSource {
  readonly kind: "cron" | "git" | "pr" | "ci" | "file" | "presence" | "inbound" | "webhook" | string;

  start(bus: EventBus): Promise<void>;
  stop(): Promise<void>;
  describe(spec: TriggerSpec): string;       // for UI
}

// triggers fire via the event bus:
//   bus.emit({ type: "trigger.fired", payload: { source, spec, context } });
```

Playbook engine subscribes to `trigger.fired`, resolves specs to playbook
bindings, and dispatches.

Adding a new trigger kind (e.g. "calendar event starting in 15 min") is
one adapter. Execution path is unchanged.

### AttachmentIngestor

```ts
interface AttachmentIngestor {
  readonly kinds: string[];                  // e.g. ["pdf", "application/pdf"]
  extractText(file: Path): Promise<ExtractedText>;
  extractMetadata?(file: Path): Promise<Record<string, unknown>>;
}
```

Default impls: `MarkdownIngestor`, `PlainTextIngestor`, `PdfTextIngestor`.
Future: `UrlIngestor`, `ImageOcrIngestor`, `AudioTranscribeIngestor`,
`EmailThreadIngestor`.

### Inferrer (Learning layer)

```ts
interface Inferrer<TSignal, TSuggestion> {
  readonly domain: "preferences" | "routing" | "playbooks" | string;
  ingest(signal: TSignal): Promise<void>;
  suggest(): Promise<TSuggestion[]>;
  explain(suggestionId: string): Promise<Evidence>;
}
```

All suggestions go through the **shadow → confirm** flow in 011. Reversal
surfaces are uniform across inferrers.

### AutonomyPolicy

```ts
interface AutonomyPolicy {
  decide(ctx: AutonomyContext): "allow" | "require_approval" | "deny";
}
```

Default: rules-based matrix from `001/security-model.md` and
`001/mcp-registry.md`. Custom policies can key on time of day, workspace
tag, remote-vs-local caller, etc.

### AgentRegistry

`AgentRegistry` is the seam for adding new WARD agents without expanding the
Orchestrator Brain's permanent prompt. Agents declare a manifest, accepted
context packet, output schema, artifact reads/writes, and approval gates.
The full schema lives in [`agent-contract.md`](agent-contract.md).

```ts
interface AgentRegistry {
  list(): Promise<WardAgentManifest[]>;
  get(id: string): Promise<WardAgentManifest | null>;
  select(input: AgentSelectionInput): Promise<WardAgentManifest[]>;
}

interface AgentRunner {
  run(manifest: WardAgentManifest, packet: AgentContextPacket): AsyncIterable<WardEvent>;
}
```

Built-ins cover planning, coding, quality gate, QA, QA Supervisor,
documentation, and reporting. Future scheduler, communication, automation,
security, accessibility, or domain-specific review agents plug in here.
WARD stores only the returned `AgentSignal` in live orchestration context;
details remain in hard-memory artifacts.

### RedactionRule

```ts
interface RedactionRule {
  readonly id: string;
  readonly severity: "info" | "warn" | "block";
  match(content: string): RedactionMatch[];
  redact(content: string): string;
}
```

Default rule set in `001/security-model.md`. Users can add custom
patterns via preferences.

## Enforcing Layering

A dependency lint (dependency-cruiser or eslint-plugin-boundaries) runs in
CI from Task 002 onward. Rules:

- Layer packages may import from `packages/core/contracts` and from
  lower-level layer packages only through their public entry points.
- Cross-layer imports that bypass a contract are build errors.
- New interfaces land in `packages/core/contracts/` before their first
  implementation ships.

This keeps the seams real. Without it, layers are decorative.

## Integrations vs. Seams

A frequent confusion: **an integration is not a seam**. Examples:

- GitHub, Slack, Vercel, Linear, Supabase, Sentry → **integrations**
  (consumers of the MCP / Connection layer)
- Google Calendar, Outlook Calendar → **integrations** (consumers of
  `TriggerSource` + MCP)
- Project management tools → **integrations** (consumers of MCP +
  `task.external_ref_json`)
- Email as a command carrier → **integration** (consumer of
  `RemoteChannel`)
- Email as an attachment source → **integration** (consumer of
  `AttachmentIngestor`)

Integrations grow without bound; seams stay small. That's the point.

## Versioning

Each contract carries a `version` field in the type name or adjacent
metadata. Breaking changes require a new version; the runtime supports
at least the previous major version for one release cycle. This gives
third-party adapter authors time to update.
