# Task 009C: MCP Server Lifecycle and Doctor

- Status: `testing`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 009B
- Recommended Tier: `balanced`

## Overview

Turn the MCP registry into a verifiable local server manager. This slice adds
a minimal MCP lifecycle/doctor layer that can spawn enabled stdio servers,
run the MCP `initialize` and `tools/list` handshake, persist status snapshots,
write stderr logs, and report results through CLI/API. A deterministic local
fixture server is used first so we can verify behavior without real GitHub,
Slack, or cloud tokens.

## Requirements

- Add schema/status contracts for MCP server checks and snapshots.
- Add migration `0009_mcp_state.sql` for server status snapshots.
- Add a minimal stdio MCP client handshake:
  - send `initialize`
  - accept `initialize` response
  - send `tools/list`
  - record tool count and basic tool names
- Add a simulated MCP fixture server for deterministic smoke tests.
- Add `ward mcp doctor [--workspace <slug>]`.
- Add `GET /api/mcp/servers`.
- Add `POST /api/mcp/doctor`.
- Write stderr logs under `~/.ward/logs/mcp/<server_id>.log`.
- Redact env/header values from doctor output.
- Preserve runtime stability: failed MCP checks must not crash the daemon.

## Out of Scope

- Long-lived server pools.
- Tool invocation proxy.
- Circuit breakers and quota freeze logic.
- HTTP MCP lifecycle beyond status placeholders.
- Real GitHub/Slack/Vercel server verification.
- UI Connections panel.

## Proposed File Changes

- `packages/core/src/mcp/index.ts` - Add lifecycle, doctor, and tool summary
  schemas.
- `packages/memory/migrations/0009_mcp_state.sql` - Add MCP server status
  table.
- `packages/memory/src/mcp.ts` - Add doctor/status persistence helpers.
- `packages/memory/src/mcp-client.ts` - Add minimal stdio MCP handshake.
- `packages/memory/src/mcp-fixture-server.ts` - Add deterministic fixture
  server used by smoke tests.
- `apps/runtime/src/index.ts` - Add MCP status and doctor routes.
- `apps/cli/src/main.ts` - Add `ward mcp doctor`.
- `docs/task/009-mcp-connections.md` - Record slice completion notes.
- `TASKS.md` - Move 009C through status gates.

## Code Context

- `packages/memory/src/mcp.ts` already loads scoped configs and builds
  overlays from global/workspace config.
- `packages/memory/src/secrets.ts` resolves `secret://` references and should
  be reused for doctor spawn env.
- `apps/runtime/src/index.ts` already exposes `/api/mcp/effective` and scoped
  config mutation routes.
- `apps/cli/src/main.ts` already owns `ward mcp list|add|enable|disable|remove`.
- `packages/memory/src/migrations.ts` automatically applies numbered SQL
  files in migration order.

## Implementation Steps

1. Add MCP lifecycle/status schemas.
2. Add the MCP status migration and repository helpers.
3. Add a small stdio JSON-RPC transport helper with timeout handling.
4. Add the fixture MCP server with a fixed `tools/list` response.
5. Implement doctor checks for enabled stdio servers.
6. Persist status snapshots and stderr logs.
7. Add runtime API routes.
8. Add CLI command.
9. Run isolated smoke with file secrets backend and fixture MCP server.
10. Update docs and task tracking.

## Acceptance Criteria

1. `ward mcp doctor` checks an enabled fixture stdio server and reports tool
   count.
2. `GET /api/mcp/servers` returns the last status snapshot.
3. Failed spawn, timeout, and invalid JSON are reported as errored checks
   without crashing runtime.
4. Stderr is captured under `~/.ward/logs/mcp/`.
5. Doctor output does not include raw env/header secrets.
6. Schema migration applies cleanly from a fresh `WARD_HOME`.
7. `bun run typecheck`, `bun run build`, and `git diff --check` pass.

## Verification

- `bun run typecheck`
- `bun run build`
- `git diff --check`
- `WARD_HOME=/tmp/ward-task009c-smoke WARD_SECRET_BACKEND=file bun run ward --json init`
- add fixture MCP server with `ward mcp add fixture --scope global --command ...`
- `WARD_HOME=/tmp/ward-task009c-smoke WARD_SECRET_BACKEND=file bun run ward --json mcp doctor`
- `WARD_HOME=/tmp/ward-task009c-smoke WARD_SECRET_BACKEND=file bun run ward --json mcp servers`
- API smoke for `/api/mcp/servers` and `/api/mcp/doctor`
- verify stderr log file exists and secret-like env values are redacted

## Implementation Notes

### What Changed

- Added typed MCP lifecycle/status contracts, schema version 9 storage, and
  persisted server status snapshots.
- Added a minimal stdio MCP probe that performs `initialize`,
  `notifications/initialized`, and `tools/list`.
- Added a deterministic fixture MCP server for local smoke checks and failure
  modes.
- Added `ward mcp doctor`, `ward mcp servers`, `GET /api/mcp/servers`, and
  `POST /api/mcp/doctor`.
- Added stderr log capture under `~/.ward/logs/mcp/` with resolved env/header
  value redaction.

### Files Changed

- `packages/core/src/mcp/index.ts` - lifecycle status, tool summary, status
  snapshot, and doctor result schemas.
- `packages/memory/migrations/0009_mcp_state.sql` - MCP status snapshot
  persistence.
- `packages/memory/src/mcp-client.ts` - stdio JSON-RPC probe helper.
- `packages/memory/src/mcp-fixture-server.ts` - deterministic local MCP
  fixture server.
- `packages/memory/src/mcp.ts` - doctor orchestration, secret resolution,
  status persistence, log paths, and status listing.
- `apps/runtime/src/index.ts` - MCP status and doctor API routes.
- `apps/cli/src/main.ts` - `ward mcp doctor` and `ward mcp servers`.
- `TASKS.md` and `docs/task/009-mcp-connections.md` - slice tracking.

### Deviations From Plan

- Added `ward mcp servers` as a small CLI read surface for the required
  `GET /api/mcp/servers` status snapshots.
- HTTP MCP servers are recorded as `unsupported` instead of failed because
  HTTP lifecycle checks remain explicitly out of scope for this slice.

### Verification Run

- `bun run typecheck` - PASS
- `bun run build` - PASS
- `git diff --check` - PASS
- `bun test` - SKIPPED (repo has no test files yet; Bun exits 1)
- `WARD_HOME=/tmp/ward-task009c-smoke WARD_SECRET_BACKEND=file bun run ward --json init` - PASS
- `WARD_HOME=/tmp/ward-task009c-smoke WARD_SECRET_BACKEND=file bun run ward --json mcp add fixture --scope global --command bun --arg packages/memory/src/mcp-fixture-server.ts --env WARD_FIXTURE_TOKEN=...` - PASS
- `WARD_HOME=/tmp/ward-task009c-smoke WARD_SECRET_BACKEND=file bun run ward --json mcp doctor` - PASS
- `WARD_HOME=/tmp/ward-task009c-smoke WARD_SECRET_BACKEND=file bun run ward --json mcp servers` - PASS
- Direct API smoke for `GET /api/mcp/servers` and `POST /api/mcp/doctor` - PASS
- Fixture stderr log redaction check - PASS
- Invalid JSON fixture failure smoke - PASS
- Timeout fixture failure smoke - PASS
- Missing executable failure smoke - PASS
- `WARD_HOME=/tmp/ward-task009c-smoke WARD_SECRET_BACKEND=file bun run ward --json down` - PASS
