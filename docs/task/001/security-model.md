# Appendix: Security Model

WARD is single-user and local-first but handles real secrets, connects to
third-party services, spawns processes that execute code, and — when remote
messaging is enabled — accepts inbound commands from external channels.
This document defines the threat model and the controls.

## Threat Model

### Assets Protected

- **Subscription credentials** (Claude Code, Codex login state)
- **API keys and tokens** (Anthropic, OpenAI, GitHub PAT, Slack bot, Vercel,
  Supabase, Sentry, etc.)
- **Repo contents** and local filesystem
- **Wiki content** (may contain project-sensitive summaries)
- **SQLite state** (workspace data, conversation history)
- **Session transcripts and artifacts** (may contain leaked secrets from
  worker output)

### Threat Actors

| Actor | Capability | Mitigations |
|---|---|---|
| Local malicious process | Read `~/.ward/` if run as same user | Keychain for secrets, 0600 file perms, no raw secrets in config files |
| Other user on same machine | Read files owned by WARD user | Same as above; document "single-user machine" assumption |
| Network attacker (LAN) | Reach loopback ports if misconfigured | Default bind `127.0.0.1`; LAN bind is explicit opt-in with warning |
| Compromised third-party MCP server | Arbitrary code in WARD process space (stdio subprocess) | Subprocess isolation; tool allowlists; autonomy-gated calls |
| Malicious inbound message (Slack / Telegram) | Trigger destructive action | Signed webhooks, allowlisted senders, destructive-action UI approval, rate limits |
| Prompt injection via wiki / attachments / tool results | Exfiltrate secrets, misuse tools | Redaction on egress, tool allowlist, autonomy gates, Brain Mode routing that never lets Silent mode invoke destructive tools |
| Lost laptop | Full disk access | Relies on OS full-disk encryption (FileVault / LUKS); `ward` does not add at-rest encryption for MVP |
| Supply chain (malicious npm package) | Code execution on install | Pinned versions, lockfile, review policy for new deps, no auto-update of MCP servers |

### Explicit Non-Goals

- Defending against a compromised user account on the same machine.
- Defending against `root` / `sudo` adversaries.
- At-rest encryption beyond OS full-disk.
- Hiding WARD's existence from other local processes.

## Network Posture

### Default

- **Loopback only**: Runtime binds `127.0.0.1:<port>` by default.
- **No LAN, no public exposure.**
- UI is served from the same loopback origin.

### Opt-in LAN

- Config: `network.bind = "0.0.0.0"` with an explicit warning on next
  daemon start.
- LAN bind still requires the device token for every request.
- Displayed prominently in the UI status bar.

### Remote Access

Two supported patterns, both outbound-initiated:

1. **Vendor bot channel** (recommended) — Slack Socket Mode or Telegram
   long-poll. No inbound port opened. WARD initiates a persistent WebSocket
   / long-poll to the vendor, which pushes messages in.
2. **User-managed tunnel** — Tailscale, Cloudflare Tunnel, or similar. The
   tunnel authenticates the device; WARD sees an authenticated request on
   loopback. **WARD does not ship its own tunnel.**

### Never Supported

- Opening an inbound port on a public IP.
- Webhook endpoints without signature verification.
- Auth-less remote access.

## Identity

Even single-user, WARD maintains a small Identity model because the moment
you add a second remote channel, sender-matching and allowlisting become
non-trivial.

### Entities

- **User Profile** (singleton): name, honorific, timezone, work hours,
  quiet hours, persona, TTS preferences, presence default.
- **External Identity**: a `(channel, external_id)` pair that represents
  you on a specific carrier. Example: `(slack, U01ABC)`,
  `(telegram, 4821935)`, `(github, eljun)`, `(email, you@you.com)`.
- **Remote Allowlist Entry**: an External Identity permitted to issue
  inbound commands. Role tag: `owner` (you) or `delegate` (future,
  post-MVP — e.g., an assistant who can issue read commands).

### Model

```ts
type UserProfile = {
  id: "self";                  // singleton
  display_name: string;
  honorific?: string;
  timezone: string;
  work_hours: { start: string; end: string };
  quiet_hours: { start: string; end: string };
  persona: { tone?: "formal" | "casual"; verbosity?: "terse" | "normal" | "verbose" };
  tts: { enabled: boolean; voice?: string; rate?: number; pitch?: number };
  presence_default: "present" | "away" | "dnd";
};

type ExternalIdentity = {
  id: string;
  channel: "slack" | "telegram" | "email" | "github" | "discord" | string;
  external_id: string;         // opaque per channel
  display_name?: string;
  verified_at?: string;
};

type RemoteAllowlistEntry = {
  id: string;
  identity_id: string;
  role: "owner" | "delegate";
  allowed_commands: string[];  // subset of the global allowlist
  expires_at?: string;         // optional, for time-bound delegation
};
```

### Binding External Identities

On first inbound from a new sender on any channel, WARD:

1. Hashes the sender's `external_id` with channel-specific salt.
2. Looks up `ExternalIdentity` + `RemoteAllowlistEntry`.
3. If no match: respond with a polite rejection; log an audit event
   including the sender's display name (to help the user allowlist
   intentionally); do not process the command.
4. If match: process per command allowlist, rate limits, and autonomy
   policy.

Adding an identity: `ward identity add <channel> <external_id>
[--display-name ...] [--role owner]`. UI: Settings → Identities.

### Audit

Every inbound (accepted or rejected) records the External Identity (by
id) in the `inbound.received` event. Log queries support filtering by
identity.

### Why Its Own Layer

Without Identity as a first-class concept, each `RemoteChannel`
implementation re-implements allowlist checks. With it, the channel's
`verifySignature()` returns "authenticated as external_id X" and the
Communication layer's shared middleware handles the rest. Adding Discord
or Signal later means zero new security code.

### Future Work

- Delegation with scoped, time-bound capabilities (e.g., read-only access
  for 4 h to a spouse or assistant).
- Cross-channel identity linking (the same human across Slack and
  Telegram share an identity cluster).
- Per-identity quiet hours overriding the User Profile's defaults.

## Authentication

### Device Token

- Generated on first `ward init`, stored in `~/.ward/auth/device.key`
  (mode `0600`).
- Required on **every** API call — loopback or remote, no exception.
- Passed as `Authorization: Bearer <token>` header.
- CLI reads it from `~/.ward/auth/device.key` automatically.
- UI reads it from a one-time-injected cookie on first load.
- Rotatable via `ward auth rotate`.

### Why Uniform Auth Even On Loopback

Loopback is not a trust boundary: any local process running as the same user
can reach it. Uniform auth:

1. Forces intentional CLI / UI setup.
2. Makes remote access a config toggle, not a code change.
3. Prevents drive-by CSRF from malicious localhost web pages
   (`http://127.0.0.1:<port>` is not cross-origin to every site, but many
   browsers have gotcha behaviors; requiring a bearer header kills the
   class).

## Secrets Management

### Storage

- **Preferred**: OS keychain (macOS Keychain, Windows Credential Manager,
  Secret Service API on Linux via `libsecret`).
- **Fallback**: `~/.ward/secrets/<name>` with mode `0600`.
- **Never**: SQLite, wiki, logs, events, config files, backups (backups
  exclude secret files explicitly).

### References

All config files (`mcp.json`, `brains.yaml`) reference secrets by name:
`secret://<name>`. Resolution happens at call time, never at read time.

### Scoping

- `secret://<name>` in global config → `ward.global.<name>` in keychain.
- `secret://<name>` in a workspace config → `ward.workspace.<slug>.<name>`;
  falls back to global.
- `secret://<name>` in a repo `.mcp.json` → same fallback chain; repo files
  never contain raw secrets.

### CLI

```
ward secrets set <name> [--scope global|workspace]
ward secrets list                    # names only, never values
ward secrets unset <name>
ward secrets rotate <name>
```

## Redaction Middleware

All egress passes through a redaction filter before leaving the host or
being persisted to wiki / event payloads. Egress boundaries:

- Wiki writes
- Notification sends (Slack / Telegram / email)
- Model calls (Brain API / SDK / CLI stdin)
- Event payloads (before SSE push and SQLite write)
- Log writes

### Starter Rule Set

Patterns (regex, tuned for low false-positive on code):

- Environment file markers: lines matching `^[A-Z_]+=.{8,}$` near `.env`-
  adjacent content → redact value.
- Authorization headers: `Authorization:\s*(Bearer|Basic)\s+\S+` → redact
  token portion.
- Common key prefixes: `sk-[A-Za-z0-9]{20,}`, `xoxb-\S+`, `ghp_\S+`,
  `ghs_\S+`, `github_pat_\S+`, `AKIA[0-9A-Z]{16}`, `ASIA[0-9A-Z]{16}`,
  `AIza[0-9A-Za-z_-]{35}`, `pk_live_\S+`, `sk_live_\S+`, `xoxp-\S+`.
- JWT triplets: `eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`.
- Private key markers: `-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----`
  through the matching `END` → redact block.
- SSH key file paths: `id_(rsa|ed25519|dsa|ecdsa)` full content read attempts
  → block.
- Custom user-defined patterns in preferences.

Redaction replaces the sensitive substring with `<redacted:<kind>>`. The
redaction event (pattern class, egress boundary, trace id) is logged — the
redacted content is not.

### False-Positive Handling

- Redaction runs at the egress boundary, not at content creation. Wiki
  content, event content, and model-call content may originate from user
  input that legitimately mentions token patterns (e.g., documentation). In
  those cases, the redaction is logged but the user can see it on the UI
  side via an inline `…content elided for safety…` marker, and can request
  an unredacted preview that stays local (never sent over model calls or
  notifications).

## Inbound Remote Messaging

### Slack (Primary)

- **Transport**: Slack Socket Mode (WebSocket initiated from WARD, no inbound port).
- **Signing verification**: every incoming event is signature-verified
  against `SLACK_SIGNING_SECRET` (stored as `secret://slack-signing`).
- **Sender allowlist**: only Slack user IDs listed in
  preferences under `remote.allowed_users` can send commands. Others receive
  a standard "not authorized" reply.
- **Replay protection**: nonce + timestamp window (5 min) check on every
  event.
- **Command allowlist**: only commands in `remote.allowed_commands` are
  dispatched. Default: `status`, `resume`, `ask`, `note`, `approve`,
  `reject`, `workspaces`. Destructive commands not in this set.
- **Destructive action gate**: `approve` is the only destructive-adjacent
  command permitted over remote. It releases an already-pending UI prompt —
  it never initiates destructive action. True destructive actions
  (merge, delete, force-push) still require UI approval on a device with
  display.
- **Rate limiting**: per-user, default 30 commands / 5 min.

### Telegram (Secondary)

- **Transport**: long-polling (`getUpdates`), initiated by WARD.
- **Bot token**: `secret://telegram-bot-token`.
- **Sender allowlist**: Telegram user IDs in preferences.
- **Command allowlist**: same set as Slack.
- **Rate limit**: same as Slack.

### Audit

Every inbound command is logged as a `session_event` of type
`inbound.received` (signature-verified or rejected) and `inbound.command`
(parsed). Logged fields: channel, external user id, command, decision
(accepted / rejected), reason, trace id. Message text is stored after
redaction.

## Process and MCP Safety

### Subprocess Isolation

- MCP stdio servers run as child processes of the Runtime with the same
  uid. They do **not** get additional capabilities; they inherit
  only explicitly-passed environment variables.
- Working directory for a spawned MCP server is limited to a scratch
  directory unless the server explicitly needs a real path (e.g.,
  `@modelcontextprotocol/server-filesystem <path>`).
- No elevated privilege paths. If an MCP server requests elevation, WARD
  refuses.

### Tool Allowlist Enforcement

Every MCP tool call passes through the Runtime proxy. The proxy:

1. Resolves the tool class (`read` / `write` / `destructive` / `privileged`).
2. Checks per-run `allowed_tools`.
3. Checks autonomy level × tool class policy.
4. For destructive/privileged: requires an approval record (UI click,
   Slack `approve`, or pre-approval flag for lenient mode).
5. On deny, returns a synthetic tool result explaining the denial. Does
   not call the real MCP server.

### Worker Prompt Injection Mitigation

Worker output and MCP tool results are treated as **untrusted**. The
Runtime does not let any LLM output directly trigger a destructive call:

- Destructive tool calls always pass through the autonomy gate (Intervention
  mode on `standard`, pre-approval on `lenient`).
- Silent / background mode is not allowed to call `write` or above.
- Orchestrator prompt templates include explicit instruction that
  untrusted content never overrides autonomy policy.

## Data Retention and Deletion

- **Events**: retained 30 days by default (configurable). Daily rollup
  summary kept longer.
- **Session transcripts**: retained indefinitely; manual `ward session prune`.
- **Logs**: 30-day rotation.
- **Backups**: 7 nightly rotating backups by default; secrets excluded.
- **Wiki**: never auto-pruned (git history preserves).

`ward purge` (destructive) wipes session transcripts, event rows, and logs.
It does **not** wipe wiki or SQLite operational state by default; separate
flags guard those.

## Observability and Audit

- Every authentication event: logged.
- Every `mcp.tool_denied`: logged.
- Every `inbound.*` event: logged.
- Every `brain.call_*`: logged (without payload by default; full payload
  only when `debug_trace` is enabled for a trace id).
- `ward audit tail` streams the audit subset of logs in real time.

## Startup Sanity (`ward doctor`)

Security-relevant checks:

- Device token file exists and has mode `0600`.
- Keychain backend available and unlocked.
- No secret files with mode looser than `0600`.
- `network.bind` is `127.0.0.1` OR an explicit acknowledgement flag is set.
- MCP servers all resolve without leaking raw secrets in their config.
- Redaction patterns compile.

`ward doctor` failure modes block `ward up` by default; override with
`--force` and a warning is logged.

## Reversibility

Every learned preference, every routing heuristic, every playbook, every
automated wiki edit must be **inspectable and reversible**. No permanent
silent state. Reversal surfaces:

- UI: preference and heuristic inspection panels with "disable" and "revert
  to last version".
- CLI: `ward pref show|unset`, `ward playbook disable`, `ward routing
  reset`.
- Git-backed wiki: `git revert` a commit rolls back any LLM edit.

## Future Work (out of MVP)

- GH App instead of PAT for GitHub (per-install auth, finer scopes).
- Per-session MCP server sandboxing (seccomp / bwrap on Linux, sandbox-exec
  on macOS).
- At-rest encryption of `~/.ward/` for users who don't enable OS FDE.
- HSM-backed device token.
- Structured capability tokens (fine-grained, time-bound) for remote
  commands.
