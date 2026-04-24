# Appendix: MCP Registry

MCP (Model Context Protocol) is WARD's connection layer. All third-party
integrations — GitHub, Slack outbound, Vercel, Supabase, filesystem, and
future tools — are reached through MCP servers. WARD adds structured scoping
around MCP configuration so different workspaces can carry different
connections.

## Three Scopes

| Scope | Lives in | Examples | Who manages |
|---|---|---|---|
| **Global** | `~/.ward/mcp.json` + secrets in keychain | Slack bot token, personal GitHub PAT, Vercel team token, default filesystem root | User, once per machine |
| **Workspace** | `~/.ward/workspaces/<slug>/mcp.json` | Vercel project ID for Project X, Linear team, Sentry org | User, when editing a workspace |
| **Repo** | `.mcp.json` in the linked repo root (Claude Code's native format) | Supabase MCP for Project X database, repo-specific tools | Committed to the repo |

**Closer scope wins** on conflict: Repo > Workspace > Global.

**Effective set** for a run = `Global ∪ Workspace ∪ Repo(s)`. When a
workspace links multiple repos, all repo-scope sets merge; conflicts between
linked repos resolve in favor of the primary repo (user notified).

## Format — Reusing Claude Code's `.mcp.json`

All three scopes use the **same file format** as Claude Code's `.mcp.json`.
This has three benefits:

1. Repos with existing `.mcp.json` files work in WARD without edits.
2. When the Runtime spawns Claude Code CLI as a worker, the worker's native
   MCP resolution sees the same servers WARD is using (plus an overlay that
   adds global + workspace scopes). No double configuration.
3. Future extensions to the format land in WARD automatically.

Format:

```json
{
  "mcpServers": {
    "<server_id>": {
      "command": "<executable>",
      "args": ["..."],
      "env": { "KEY": "value or secret://<name>" },
      "transport": "stdio" | "http",
      "url": "<url if transport=http>",
      "headers": { "Authorization": "Bearer secret://<name>" },
      "ward_tool_scopes": ["read", "write"],
      "ward_enabled": true
    }
  }
}
```

Fields prefixed with `ward_` are WARD extensions and ignored by Claude Code.
Everything else is vanilla `.mcp.json`.

## Secret References

**Raw secrets never appear in `.mcp.json` files.** All sensitive values are
`secret://<name>` references resolved at spawn time from the OS keychain.

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server"],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "secret://supabase-project-x",
        "SUPABASE_PROJECT_REF": "abc123"
      }
    }
  }
}
```

Resolution rules:

- `secret://<name>` in a global config → keychain entry `ward.global.<name>`.
- `secret://<name>` in a workspace config → keychain entry
  `ward.workspace.<workspace_slug>.<name>`, falling back to
  `ward.global.<name>` if not set (with a warning logged).
- `secret://<name>` in a repo `.mcp.json` → same fallback chain as workspace;
  the repo file never contains the secret itself, so cloning the repo never
  leaks secrets.

Secret management CLI:

```
ward secrets set <name> [--scope global|workspace]
ward secrets list                 # names only, never values
ward secrets unset <name>
ward secrets rotate <name>        # updates keychain + forces MCP server restart
```

## Lifecycle

The Runtime's MCP subsystem manages server lifecycle.

### stdio servers

- Spawned lazily on first tool call per scope-resolution key.
- Kept alive per a TTL (default 15 min idle). Idle beyond TTL → terminated.
- Respawn on crash with exponential backoff (1s, 2s, 4s, 8s, 30s cap).
- Stderr captured to `~/.ward/logs/mcp/<server_id>.log` with rotation.

### http servers

- Treated as long-lived clients, not subprocesses.
- Health-checked periodically (every 60 s).
- Retries with backoff on failure; `mcp.server_exited`-equivalent emitted
  after N failures.

## Tool Routing and Allowlists

The Runtime's MCP proxy sits between any caller (Orchestrator Brain, worker,
Plan Mode participant) and the real MCP server.

### Tool classes

Every MCP tool is classified at registry load time (heuristic + explicit
override in config):

- `read` — returns data without mutation
- `write` — mutates external state (creates PR, posts message, writes file)
- `destructive` — deletes, merges, force-pushes, drops databases
- `privileged` — moves money, production deploys

### Autonomy level × tool class policy

| Autonomy | Auto-permitted | Requires approval |
|---|---|---|
| `strict` | `read` | `write`, `destructive`, `privileged` |
| `standard` | `read`, `write` | `destructive`, `privileged` |
| `lenient` | `read`, `write`, `destructive` when CI green | `privileged`, `destructive` without CI green |

Policy is applied per-call. Blocked calls emit `mcp.tool_denied` and trigger
Orchestrator Intervention mode unless the call was made in Silent mode, in
which case the call is deferred to the next user interaction.

### Per-run allowlist

A harness launch can narrow tools further via `allowed_tools[]` in the
launch contract. The Runtime rejects any tool not in the allowlist with a
clear reason; the worker sees a synthetic `tool_not_allowed` result.

## Merging the Scopes (worked example)

Global:

```json
// ~/.ward/mcp.json
{
  "mcpServers": {
    "github":  { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
                 "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "secret://gh-pat" } },
    "slack":   { "command": "npx", "args": ["-y", "slack-mcp-server"],
                 "env": { "SLACK_BOT_TOKEN": "secret://slack-bot" } },
    "vercel":  { "command": "npx", "args": ["-y", "vercel-mcp"],
                 "env": { "VERCEL_TOKEN": "secret://vercel-token" } }
  }
}
```

Workspace (Project X):

```json
// ~/.ward/workspaces/project-x/mcp.json
{
  "mcpServers": {
    "sentry": { "command": "npx", "args": ["-y", "sentry-mcp"],
                "env": { "SENTRY_ORG": "my-org", "SENTRY_TOKEN": "secret://sentry-x" } }
  }
}
```

Repo (Project X):

```json
// ~/Code/project-x/.mcp.json
{
  "mcpServers": {
    "supabase": { "command": "npx", "args": ["-y", "@supabase/mcp-server"],
                  "env": { "SUPABASE_ACCESS_TOKEN": "secret://supabase-x",
                           "SUPABASE_PROJECT_REF": "abc123" } }
  }
}
```

**Effective set for Project X** = `github, slack, vercel, sentry, supabase`.

**Switching to Project Y** replaces the workspace and repo layers; Supabase
resolves to Project Y's credentials automatically.

## Conflict Resolution

When the same server id appears in multiple scopes:

- Repo wins over Workspace wins over Global.
- UI displays the effective config with an **origin column** so the user
  can see which scope provided each server and override if desired.
- Conflicts **between linked repos in one workspace** (both define server
  `supabase`) resolve to the primary repo's version; UI shows the conflict
  with a "rename or pin" suggestion.

## WARD as an MCP Server

WARD exposes its own state as an MCP server (`ward mcp-serve`). External
clients (including Claude Code instances outside WARD, or other MCP-aware
tools) can query:

- workspaces (list, detail)
- sessions (list, detail, events)
- plan packets (list, detail)
- wiki pages (read)
- active blockers

**Read-only for MVP.** Mutation endpoints (start session, approve, write
wiki) come in a later task after the permission model is well-understood.

## Handoff to Workers

When the Runtime spawns a Claude Code or Codex CLI worker:

1. It writes a generated overlay `.mcp.json` to
   `~/.ward/sessions/<session_id>/.mcp.json` containing the global + workspace
   layers.
2. It sets the worker's working directory to the primary repo path, so the
   worker's native `.mcp.json` resolution picks up the repo layer.
3. It sets `CLAUDE_MCP_CONFIG=<overlay_path>` (or Codex equivalent) so the
   worker merges the overlay into its effective set.
4. The worker now sees the same effective MCP set WARD's Orchestrator Brain
   sees, without any bespoke handoff protocol.

Secret references in the overlay are resolved by WARD before being written,
since the overlay file lives inside `~/.ward/` and is immediately consumed
by the worker subprocess. The overlay is deleted when the session ends.

## Configuration UX

CLI:

```
ward mcp list                           # effective config for current workspace
ward mcp list --scope global
ward mcp list --scope workspace
ward mcp list --scope repo              # reads .mcp.json of primary repo
ward mcp add <id> --scope global        # interactive add
ward mcp enable  <id> --scope workspace
ward mcp disable <id> --scope workspace
ward mcp doctor                         # spawn every enabled server, verify tool-list
ward mcp trace  <tool_name>             # log next N calls with full payloads (redacted)
```

UI: **Settings → Connections**

- Tabs: Global / Workspace / Repo
- Per server row: id, scope, status (connected / error), last used, tool
  count, enable toggle, allowlist editor
- Repo tab is read-ish: edits open `.mcp.json` in the user's editor

## Health and Monitoring

`ward doctor` runs, for every enabled MCP server:

- resolve command on PATH or URL reachable
- resolve all `secret://` references
- spawn and request `tools/list`; fail if it doesn't respond within 10 s
- report count of read / write / destructive / privileged tools

`mcp.server_*` events feed the event bus; UI surface shows real-time status.

## Testing

- Simulated MCP server adapter emits a configurable tool list and canned
  results — used in tests and in Plan Mode simulated adapters.
- Contract tests for scope merging: given fixture configs at all three
  scopes, effective set matches expected.
- Autonomy-policy tests: every tool class × autonomy level combination
  produces the expected permit / deny decision.
- Secret-leak tests: logs, SQLite rows, and wiki content are scanned for
  raw secret patterns on every CI run.
