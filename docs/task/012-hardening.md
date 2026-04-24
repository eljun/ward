# Task 012: Hardening

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `medium`
- Depends on: all prior

## Summary

Production-readiness pass for the local-first runtime. Covers backup and
restore, cost cap enforcement polish, tunneling guide for remote access,
observability polish, and export.

## In Scope

### Backup and restore

- `ward backup [--out <dir>]` — creates a timestamped tar of `~/.ward/`:
  - `data/` (SQLite)
  - `memory/` (wiki, including `.git`)
  - `attachments/`
  - `cache/`
  - `sessions/` (configurable: full or summaries only)
  - **Excluded by default**: `secrets/`, `auth/device.key`, `logs/` older
    than 7 days
- Nightly automatic backup at quiet hour (default 03:00 local-tz), 7
  rotating files in `~/.ward/backups/`
- `ward restore <tar>` — preflight (version check, schema check), confirm,
  apply
- `ward restore` never overwrites secrets; restores everything else

### Cost cap enforcement polish

- Hard caps + soft warnings at 80 %
- Per-brain daily caps from preferences
- Workspace-scoped caps (optional)
- Auto-fallback to `budget_exceeded_fallback` brain
- UI: cost dashboard with cap progress bars; "freeze brain X" emergency
  button
- Notification when cap exceeded (Slack / Telegram if away)

### Tunneling guide

- Documentation in `docs/operations/remote-access.md` covering:
  - Tailscale: install, ACL example for WARD device only, port mapping
  - Cloudflare Tunnel: install, named tunnel config, Access policy
- WARD itself does **not** ship a tunnel; document trade-offs and warn
  about open public exposure
- `ward doctor --remote` checks: bind address, presence of recognized
  tunnel processes, suggested config

### Observability polish

- Trace ID propagation verified end-to-end (CLI → Runtime → Brain → MCP
  → events)
- `ward logs tail [--trace <id>]` — live tail with optional trace filter
- `ward logs grep <query>` — search rotated NDJSON files
- Anonymous opt-in metrics aggregation (off by default; if enabled,
  buckets to `~/.ward/metrics/<date>.json` for local inspection only —
  nothing leaves the host)
- `ward doctor --warm-stats` — warm cache hit rate per key
- `ward doctor --cost-stats` — last-7-days spend / invocations per brain

### Export

- `ward export workspace <slug> [--out <dir>]`:
  - workspace metadata (JSON)
  - all sessions and events for the workspace
  - all plan packets
  - workspace wiki (with `.git` history)
  - attachments (originals)
- Format suitable for archival or transfer to another WARD install

### Single-instance polish

- Stale PID detection on startup (`flock` failure with stale process —
  prompt user)
- Crash recovery: previous-uptime accounting + `runtime.crashed` event
- Graceful shutdown signals: SIGTERM drains for up to 30 s before forced
  exit

### Update path

- `ward version` — current version + remote latest (best-effort)
- Document upgrade flow: stop daemon → install new binary → start daemon
  → migrations auto-apply
- Migration safety: backwards-only, dry-run flag (`ward migrate --dry-run`)

### Documentation pass

- README final pass with quickstart, architecture diagram, screenshots
- `docs/operations/` directory:
  - `remote-access.md`
  - `backup-restore.md`
  - `troubleshooting.md`
  - `secrets-management.md`
- All sub-task docs cross-linked from README

## Out of Scope

- At-rest encryption beyond OS FDE (deferred)
- Multi-device sync (deferred)
- Production multi-tenant deployment (out of scope by product framing)

## Acceptance Criteria

1. `ward backup` produces a restorable tar; `ward restore` on a clean
   machine restores state (excluding secrets).
2. Nightly backup runs at scheduled time; 7-file rotation honored.
3. Cost cap exceeded triggers fallback + Slack notification (when away);
   "freeze brain" button stops further calls until manually unfrozen.
4. `ward logs tail --trace <id>` filters events end-to-end across CLI,
   Runtime, Brain, and MCP.
5. Tunneling guide tested manually with Tailscale: phone-to-laptop
   command round-trip succeeds.
6. `ward export workspace` produces a self-contained directory whose
   contents validate against schemas.
7. SIGTERM during a running session: session state persists, reattach on
   next start succeeds (where worker process is alive) or session moves
   to `blocked` with reason.
8. Migration dry-run shows planned changes without applying.
9. All `docs/operations/` pages exist and link from README.

## Deliverables

- Backup / restore commands + scheduler
- Cost cap polish + freeze button
- Tunneling guide doc
- Observability commands (`ward logs *`, `ward doctor --*-stats`)
- Export command
- Operations docs

## Risks

- Backup tar size on installs with many sessions: include rotation
  guidance, document `--no-sessions` flag.
- Restore on different OS / architecture: document supported transfer
  scenarios; SQLite is portable across platforms.
- User confusion about secrets-not-in-backup: prompt clearly and
  document.
