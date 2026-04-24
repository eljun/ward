# Task 010: Inbound Remote Messaging

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 009

## Summary

Enable two-way remote messaging when the developer is away from the
workstation. **Outbound** alerts (Slack post, Telegram send) already go
through MCP servers from 009. This task adds the **inbound** half:
listening for messages from Slack and Telegram, signature verification,
sender allowlist, command parsing, presence-aware routing, destructive-
action gating, and the audit trail.

This task implements the `RemoteChannel` extension seam from
[`001/extension-seams.md`](001/extension-seams.md). Slack and Telegram
ship as the first two implementations; email is described as a third
(implementation deferred until needed). New carriers (Discord, Signal)
plug in by writing one adapter file.

## RemoteChannel interface

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

The Communication layer's shared middleware (allowlist, rate limit, audit
log, presence-aware routing, redaction) is **channel-agnostic** and runs
above each `RemoteChannel`. Adding Discord = one file + one registry
entry.

## In Scope

### Slack inbound (primary)

- **Slack Socket Mode** WebSocket initiated from WARD (no inbound port)
- App-level token (`xapp-...`) stored as `secret://slack-app-token`
- Bot token (`xoxb-...`) reused from 009 outbound MCP
- Signing secret stored as `secret://slack-signing`
- Event types subscribed: `app_mention`, `message.im`, `interactive`
  (button callbacks for Intervention modals)
- Signature verification on every event
- Replay protection: nonce + timestamp window (5 min)

### Telegram inbound (secondary)

- Long-polling (`getUpdates`) initiated from WARD
- Bot token: `secret://telegram-bot-token`
- Same command set as Slack
- Inline keyboard support for Intervention approve/reject

### Email as a third carrier (interface only — impl deferred)

- `EmailChannel` implementing `RemoteChannel`:
  - Outbound: SMTP (or transactional API like Resend / SES) via secrets
  - Inbound: IMAP poll with a dedicated mailbox or webhook-forwarded
    alias (e.g. `ward+commands@your-domain`)
  - Signature: DKIM verification on inbound; per-sender token in subject
    line as a backup
- This task ships the `EmailChannel` class skeleton + tests against a
  mock SMTP/IMAP server, but does **not** wire it into the live config by
  default. Activation is a documented opt-in (typically requires a
  user-controlled domain).
- Goal: prove the seam fits a third carrier so the design holds, without
  taking on real-world spam / deliverability work in MVP.

### Sender allowlist + command allowlist

- `remote.allowed_users` preference: list of `{channel, external_id,
  display_name, role}`
- `remote.allowed_commands` preference: default
  `[status, workspaces, resume, ask, note, approve, reject]`
- Unauthorized sender → polite rejection + audit log
- Disallowed command → list of available commands + audit log

### Command set (MVP)

| Command | Effect | Destructive? |
|---|---|---|
| `status` | reply with daily brief | no |
| `workspaces` | list active workspaces | no |
| `resume <workspace>` | queue a resume session | gated |
| `ask <workspace> <question>` | conversational reply with context | no |
| `note <workspace> <text>` | append to wiki log | gated |
| `approve <intervention-id>` | release pending Intervention | yes (releases something already gated by UI) |
| `reject <intervention-id>` | reject pending Intervention | no |
| `help` | list commands | no |

True destructive actions (PR merge, branch delete, force push) **never**
initiate from remote. They require UI approval on a device with display.
Remote `approve` only releases a previously-queued Intervention.

### Rate limiting

- Per-user, per-channel: default 30 commands / 5 min
- Burst cap: 5 commands / 10 s
- Exceeded → `inbound.rejected` with reason `rate_limit`

### Presence-aware routing

- `presence.changed` events drive remote behavior:
  - `present` (UI heartbeat in last 2 min): notifications go to UI; remote
    commands still accepted but lower priority
  - `away`: full remote command set + alert composer routes notifications
    to remote channels
  - `dnd` (quiet hours from profile): only `priority=high` notifications
    get sent; others queued until presence changes

### Intervention round-trip

- When Intervention mode fires while user is `away`:
  - Alert composer formats `{ask, options, recommended, reason}` into a
    Slack message with action buttons (Block Kit) or Telegram inline
    keyboard
  - User taps a button → Slack interactive event → WARD verifies signature
    + sender → resumes the harness with the decision
  - Timeout: per-Intervention TTL (default 30 min); on expiry → harness
    moves to `blocked` with reason `intervention_timeout`

### Audit trail

- Every inbound: `inbound.received` event with `{channel, external_user_id,
  text_redacted, signature_valid, sender_authorized}`
- Every dispatch: `inbound.command` event with `{command, params,
  decision: accepted|rejected, reason}`
- Every destructive action attempt via remote: separate `audit.destructive`
  log entry

### Channel registration

- `ward channel add slack --workspace-id <slack-team-id>`
- `ward channel add telegram --bot-token-secret <name>`
- `ward channel test <id>` — sends a test message + verifies inbound by
  echoing it back

### API

- `GET /api/channels` / `POST /api/channels` / `DELETE /api/channels/:id`
- `POST /api/channels/:id/test`
- `GET /api/inbound/log` (audit feed)
- `GET /api/presence` / `POST /api/presence` (manual override)

### CLI

- `ward channel add|list|remove|test`
- `ward presence away|present|dnd`
- `ward inbound tail` — live audit feed

### UI

- Settings → Channels: list, add, test
- Settings → Presence: current state, manual override, work hours, quiet
  hours
- Audit log viewer

## Out of Scope

- Email channel (deferred, post-MVP)
- Push notifications (deferred)
- STT for voice messages (out of scope for MVP)
- WARD-as-MCP-server mutation endpoints (deferred)

## Acceptance Criteria

1. Slack Socket Mode connects on daemon start (when channel configured);
   `ward channel test slack` round-trips a message.
2. Telegram long-poll connects; `ward channel test telegram` round-trips.
3. Unauthorized Slack/Telegram user receives polite rejection; audit log
   records it.
4. `status` from authorized Slack user replies with daily brief.
5. `resume <workspace>` queues a session and replies with the session id.
6. While user is `away`, an Intervention from a running harness sends a
   Slack message with action buttons; tapping a button releases the
   harness with the chosen decision.
7. Intervention TTL: untouched after 30 min → harness moves to `blocked`.
8. Rate limit: 31st command in 5 min is rejected with `rate_limit`.
9. Quiet hours: low-priority notification queued, high-priority sent.
10. All inbound payloads redacted in events and logs.

## Deliverables

- Inbound listener package
- Slack Block Kit message composer
- Telegram inline keyboard composer
- Channel + presence repositories (migration `0010_channels.sql`)
- API + CLI + UI
- Audit log viewer

## Risks

- Slack signing secret rotation requires user to re-set; document in
  `ward doctor`.
- Long-poll Telegram battery / network: 30s long-poll, exponential backoff
  on errors.
- Webhook signature verification edge cases: thorough fuzz tests.
