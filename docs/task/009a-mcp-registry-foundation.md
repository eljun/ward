# Task 009A: MCP Registry Foundation

- Status: `done`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 009
- Recommended Tier: `balanced`

## Overview

Start Task 009 with the part everything else depends on: a local-first MCP
registry that reads the same `.mcp.json` shape as Claude Code, merges global,
workspace, and repo scopes, redacts sensitive values for UI/API output, and
writes global/workspace overlays into harness sessions.

## Requirements

- Add MCP schemas for scope, transport, tool class, server config, effective
  config, and mutations.
- Read global config from `~/.ward/mcp.json`.
- Read workspace config from `~/.ward/workspaces/<slug>/mcp.json`.
- Read repo config from linked repo `.mcp.json`.
- Merge scopes using repo > workspace > global precedence.
- Surface conflicts in the effective config.
- Redact sensitive environment/header values in API and CLI output.
- Add CLI/API surfaces for listing effective/scoped configs and adding,
  enabling, disabling, or removing global/workspace servers.
- Generate harness MCP overlays from global + workspace config.

## Out of Scope

- Spawning real MCP servers.
- Tool invocation proxy.
- Circuit breakers.
- OS keychain secret storage.
- WARD-as-MCP-server.
- Settings UI for Connections.

## Implementation Notes

### What Changed

- Added core MCP schemas and mutation contracts.
- Added memory-layer MCP config file readers/writers, scoped merge logic, and
  redaction.
- Added API routes under `/api/mcp`.
- Added `ward mcp list|add|enable|disable|remove`.
- Updated harness launch preparation to include the global/workspace MCP
  overlay instead of an empty `mcpServers` object.

### Files Changed

- `packages/core/src/mcp/index.ts` - MCP schemas and public contracts.
- `packages/core/src/index.ts` - Exports MCP contracts.
- `packages/memory/src/mcp.ts` - Scoped MCP config store, merge, redaction,
  and session overlay builder.
- `packages/memory/src/index.ts` - Exports MCP memory helpers.
- `packages/memory/src/sessions.ts` - Writes merged MCP overlays for sessions.
- `apps/runtime/src/index.ts` - Adds MCP API routes.
- `apps/cli/src/main.ts` - Adds MCP CLI commands.
- `TASKS.md` - Moves Task 008 to Done and starts Task 009.

### Deviations From Plan

- Secret references are preserved as `secret://...` in this slice. Actual
  keychain resolution lands in the next Task 009 slice.
- Repo-scope edits stay read-only; CLI/API mutations are limited to global
  and workspace config files.

### Verification Run

- `bun run typecheck` - PASS
- `WARD_HOME=/tmp/ward-task009-smoke bun run ward --json init` - PASS
- `WARD_HOME=/tmp/ward-task009-smoke bun run ward --json create-workspace "MCP Smoke" --description "MCP registry verification" --repo /tmp/ward-task009-repo` - PASS
- `WARD_HOME=/tmp/ward-task009-smoke bun run ward --json mcp add github --scope global --command global-gh --env GITHUB_TOKEN=raw-global-token --tool-scope read` - PASS
- `WARD_HOME=/tmp/ward-task009-smoke bun run ward --json mcp add github --scope workspace --workspace mcp-smoke --command workspace-gh --env GITHUB_TOKEN=secret://workspace-gh --tool-scope write` - PASS
- repo fixture `.mcp.json` defines `github` and `playwright` servers - PASS
- `WARD_HOME=/tmp/ward-task009-smoke bun run ward --json mcp list --workspace mcp-smoke` - PASS
  - Effective `github` came from repo scope.
  - Conflicts reported workspace-over-global and repo-over-workspace.
  - Raw repo token was redacted.
  - Repo `playwright` surfaced with `browser_qa` capability profile.
- `WARD_HOME=/tmp/ward-task009-smoke bun run ward --json mcp disable github --scope workspace --workspace mcp-smoke` - PASS
- `WARD_HOME=/tmp/ward-task009-smoke bun run ward --json mcp enable github --scope workspace --workspace mcp-smoke` - PASS
- `WARD_HOME=/tmp/ward-task009-smoke bun run ward --json mcp add temp-remove --scope global --command temp-mcp` - PASS
- `WARD_HOME=/tmp/ward-task009-smoke bun run ward --json mcp remove temp-remove --scope global` - PASS
- `WARD_HOME=/tmp/ward-task009-smoke bun run ward --json session launch mcp-smoke --scenario default --goal "Verify MCP overlay foundation"` - PASS
- generated session overlay contains workspace `github` config, WARD metadata,
  and no repo-scope `playwright` server - PASS
- `WARD_HOME=/tmp/ward-task009-smoke bun run ward --json session show session_316c3d34b6714063` - PASS (`done`)
- `WARD_HOME=/tmp/ward-task009-smoke bun run ward --json mcp list --scope global` - PASS (`GITHUB_TOKEN` redacted)
- `bun run build` - PASS
- `git diff --check` - PASS
- `WARD_HOME=/tmp/ward-task009-smoke bun run ward --json down` - PASS

## Acceptance Criteria

1. Global, workspace, and repo `.mcp.json` files merge with documented
   precedence.
2. Effective config includes conflict metadata when the same server id appears
   in multiple scopes.
3. API/CLI output redacts raw sensitive values but preserves `secret://`
   references.
4. Global/workspace servers can be added, enabled, disabled, and removed from
   CLI/API.
5. Harness launch writes a global + workspace MCP overlay.
6. Typecheck and production build pass.
