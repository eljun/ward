# Task 009: MCP Connections Layer

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 002, 003

## Summary

Implement the full MCP connection layer per `001/mcp-registry.md`: client,
three-scope registry (global / workspace / repo), server lifecycle, secret
injection, tool routing with allowlist enforcement, autonomy-class policy,
and WARD-as-MCP-server (read-only).

## In Scope

### Three-scope merger

- `~/.ward/mcp.json` → global
- `~/.ward/workspaces/<slug>/mcp.json` → workspace
- `<linked-repo>/.mcp.json` → repo (Claude Code's native format)
- Effective set = `Global ∪ Workspace ∪ Repo(s)`, closer scope wins
- Multi-repo workspaces merge all linked repo files; primary repo wins on
  conflict; UI surfaces the conflict

### Secrets

- OS keychain integration (`keytar` or equivalent):
  - macOS Keychain
  - Windows Credential Manager
  - Linux Secret Service (libsecret) — fallback to `~/.ward/secrets/` (0600)
    if libsecret unavailable
- `secret://<name>` resolver with scope fallback chain
- `ward secrets set <name> [--scope global|workspace] [--workspace <slug>]`
- `ward secrets list` (names only)
- `ward secrets unset <name>`
- `ward secrets rotate <name>` — updates keychain + restarts MCP servers
  using that secret

### MCP client + server lifecycle

- stdio MCP server spawn with `ward_enabled: true` filter
- Idle TTL (default 15 min); idle exit + lazy respawn
- Crash respawn with exponential backoff
- HTTP MCP servers as long-lived clients with periodic health-check
- Stderr captured to `~/.ward/logs/mcp/<server_id>.log` rotating
- Events: `mcp.server_started`, `mcp.server_exited`, `mcp.tool_invoked`,
  `mcp.tool_result`, `mcp.tool_denied`

### Circuit breakers

- Per-server failure-rate policy using the unified `quota_ledger`
  (introduced in 008) per [`001/quota.md`](001/quota.md):
  - rolling 60 s failure count
  - open state freezes the server for a configurable duration
  - half-open probe after freeze; closes if probe succeeds
- Events: `quota.frozen`, `quota.unfrozen` (scope `mcp_server`).
- Breaker open → tool calls return synthetic `server_unavailable` result
  with retry hint; no calls reach the real server until closed.
- UI surfaces open breakers prominently; `ward quota unfreeze` allows
  manual override.

### Tool classification + autonomy policy

- Heuristic classifier (read / write / destructive / privileged) with
  per-server explicit overrides
- Autonomy-class matrix from `001/security-model.md`
- Per-run `allowed_tools[]` filter from harness launch contract
- Denied calls return synthetic `tool_not_allowed` result + emit
  `mcp.tool_denied`
- Trigger Intervention mode for write/destructive denials in interactive
  flows

### Agent capability MCP profiles

- Define capability profiles that agents can request without knowing server
  implementation details:
  - `browser_qa` → Playwright MCP or equivalent browser automation server
  - `repo_hosting` → GitHub / GitLab MCP
  - `deployment` → Vercel MCP
  - `database` → Supabase / Postgres MCP
- `allowed_tools[]` on `HarnessLaunch` is derived from the agent manifest,
  capability profile, autonomy policy, and workspace preferences.
- QA Agent can request `browser_qa`; WARD grants only the browser tools
  needed for the accepted test plan and records screenshots/traces as
  evidence artifacts.

### MCP overlay handoff

- On harness launch: write merged global + workspace overlay to
  `~/.ward/sessions/<id>/.mcp.json`
- Set worker env (`CLAUDE_MCP_CONFIG=...`) so the worker merges overlay
  with the repo's own `.mcp.json`
- Resolve `secret://` references in the overlay before write (it lives
  inside `~/.ward/`, immediately consumed by worker)
- Delete overlay on session end

### WARD-as-MCP-server (`ward mcp-serve`)

- Read-only tools for MVP:
  - `ward.list_workspaces`
  - `ward.get_workspace(id)`
  - `ward.list_sessions(workspace_id?, state?)`
  - `ward.get_session(id)`
  - `ward.list_plan_packets(workspace_id)`
  - `ward.get_plan_packet(id)`
  - `ward.read_wiki_page(scope, page)`
  - `ward.search(query, scope?)`
  - `ward.list_active_blockers(workspace_id?)`
  - `ward.status(state, detail?, progress_pct?)` — synthetic worker-status
    tool used by harness workers
- stdio transport
- Authenticated via short-lived per-call session token (worker gets it via
  env var) — no global access from arbitrary local process

### API

- `GET /api/mcp/effective?workspace_id=...` — merged config with origins
- `GET /api/mcp/servers` — server status (running / idle / errored)
- `POST /api/mcp/servers/:id/restart`
- `POST /api/mcp/scopes/:scope/servers` — add (global / workspace)
- `PATCH /api/mcp/scopes/:scope/servers/:id` — enable / disable / scope
  edits
- `DELETE /api/mcp/scopes/:scope/servers/:id`
- `POST /api/mcp/doctor` — spawn each enabled server + verify `tools/list`

### CLI

- `ward mcp list [--scope global|workspace|repo]`
- `ward mcp add <id> --scope global|workspace`
- `ward mcp enable|disable <id> --scope ...`
- `ward mcp doctor`
- `ward mcp trace <tool>` — log next N calls (redacted)
- `ward secrets ...` (above)
- `ward mcp-serve` — runs WARD-as-MCP-server

### UI

- Settings → Connections:
  - Three tabs: Global / Workspace / Repo
  - Per-server row: id, scope, status, last used, tool count, allowlist
    editor, enable toggle
  - Repo tab is read-ish: opens `.mcp.json` in user's editor
- Tool inspector: expand a server → see classified tools
- Conflict view when two scopes define the same server id

## Out of Scope

- Inbound remote (010)
- Mutation tools on WARD-as-MCP-server (deferred, post-MVP)
- GH App / OAuth flows (deferred; PAT-based for MVP)

## Acceptance Criteria

1. Three-scope merger returns the documented effective set for fixture
   configs; conflict resolution matches spec.
2. `ward secrets set/list/unset/rotate` round-trip via OS keychain (with
   libsecret-or-file fallback on Linux).
3. Spawning a real GitHub MCP server with a real PAT lists tools and
   answers a `repos.get` call.
4. Spawning Slack MCP outbound posts a test message to a configured
   channel.
5. Per-call autonomy gate denies a `destructive` tool under `standard`;
   approves the same call after Intervention.
6. Harness launch generates a valid overlay; spawned Claude Code CLI sees
   merged tool set.
7. WARD-as-MCP-server responds to `tools/list` and to `ward.list_workspaces`
   from an external MCP client.
8. `ward mcp doctor` passes for all configured servers.
9. A configured Playwright MCP server is classified under `browser_qa`; QA
   Agent receives an allowlisted browser tool subset and writes screenshots
   / traces to the evidence packet.
10. Logs and event payloads are redacted: no raw secrets ever appear.

## Deliverables

- `packages/connectors/mcp/` — client, registry, lifecycle, proxy
- Migration `0009_mcp_state.sql` (server status snapshot table for UI)
- Secrets repository (keychain wrapper + fallback)
- WARD-as-MCP-server binary
- API + CLI + UI
- Secret-leak CI scan

## Risks

- `keytar` native build on some systems: ship file fallback with clear
  warning + guide.
- MCP server version drift: contract tests pin minimal compatible versions.
- Large tool lists slow Brain prompt: per-mode tool-class filtering keeps
  prompts compact.
