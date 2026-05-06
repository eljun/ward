# Task 009F: WARD as a Read-Only MCP Server

- Status: `done`
- Type: `feature`
- Version Impact: `minor`
- Priority: `medium`
- Depends on: 009E
- Recommended Tier: `balanced`

## Overview

Expose WARD's local state as a read-only MCP server over stdio. External
MCP-aware agents should be able to list WARD tools and query workspaces,
sessions, plan packets, wiki pages, blockers, search results, and worker
status without receiving mutation capabilities.

## Requirements

- Add `ward mcp-serve`.
- Implement stdio MCP `initialize`, `tools/list`, and `tools/call`.
- Expose read-only tools:
  - `ward.list_workspaces`
  - `ward.get_workspace`
  - `ward.list_sessions`
  - `ward.get_session`
  - `ward.list_plan_packets`
  - `ward.get_plan_packet`
  - `ward.read_wiki_page`
  - `ward.search`
  - `ward.list_active_blockers`
  - `ward.status`
- Require a short-lived/session-scoped token for non-status reads.
- Redact sensitive payload fields.
- Keep mutation tools out of `tools/list`.
- Provide a fixture/client smoke command for validation.

## Out of Scope

- Mutation tools.
- Remote/network MCP transport.
- OAuth or external app authorization.
- UI for external MCP clients.

## Proposed File Changes

- `packages/core/src/mcp/index.ts` - Add WARD MCP tool input/output schemas
  where useful.
- `packages/memory/src/ward-mcp-server.ts` - Add stdio MCP server.
- `apps/cli/src/main.ts` - Add `ward mcp-serve`.
- `packages/memory/src/index.ts` - Export server helper if needed.
- `docs/task/009-mcp-connections.md` - Record slice notes.
- `TASKS.md` - Track 009F.

## Code Context

- Workspace/session/plan/wiki/search helpers already exist in
  `packages/memory/src/index.ts`.
- `ward.status` overlaps with the synthetic worker-status concept in
  `docs/task/001/mcp-registry.md`.
- Existing CLI runs on Bun and can host a stdio long-running command.

## Implementation Steps

1. Define WARD MCP tool list and input validation.
2. Implement stdio JSON-RPC loop.
3. Wire read-only repository helpers to tool calls.
4. Add token check for tools other than `ward.status`.
5. Add CLI entrypoint.
6. Add smoke client or Bun script verification.
7. Update docs and task tracking.

## Acceptance Criteria

1. `ward mcp-serve` responds to `initialize`.
2. `tools/list` includes only read-only WARD tools.
3. `ward.list_workspaces` returns workspace summaries to an authenticated
   client.
4. Unauthenticated non-status calls are denied.
5. `ward.status` works for harness worker status use.
6. Outputs are redacted and bounded.
7. Typecheck/build/diff checks pass.

## Verification

- `bun run typecheck`
- `bun run build`
- `git diff --check`
- stdio smoke for `initialize`
- stdio smoke for `tools/list`
- stdio smoke for authenticated `ward.list_workspaces`
- unauthenticated denial smoke

## Implementation Notes

### What Changed

- Added shared input schemas for WARD's read-only MCP tool contract.
- Added `ward mcp-serve`, a stdio MCP server that handles `initialize`,
  `tools/list`, and `tools/call`.
- Exposed ten read-only `ward.*` tools for workspaces, sessions, plans, wiki
  pages, search, blockers, and synthetic worker status.
- Required a per-server session token from `--token`,
  `WARD_MCP_SESSION_TOKEN`, or `WARD_MCP_TOKEN` for every non-status tool.
- Kept `ward.status` tokenless so harness workers can emit status without
  gaining read access.
- Added `ward mcp smoke-serve` as a fixture client for local validation.
- Added a read-only workspace detail helper so MCP reads do not update
  `last_opened_at`.
- Added recursive redaction and output bounding before returning MCP tool
  content.

### Files Changed

- `packages/core/src/mcp/index.ts` - WARD MCP tool names and input schemas.
- `packages/memory/src/ward-mcp-server.ts` - stdio MCP server, tool router,
  auth gate, redaction, and bounded results.
- `packages/memory/src/repositories.ts` - read-only workspace detail helper.
- `packages/memory/src/index.ts` - WARD MCP server export.
- `apps/cli/src/main.ts` - `ward mcp-serve` and `ward mcp smoke-serve`.
- `docs/task/009-mcp-connections.md` and `TASKS.md` - slice tracking.

### Deviations From Plan

- Added `packages/memory/src/repositories.ts` even though it was not listed
  in proposed changes. The existing workspace detail helper mutates
  `last_opened_at`, so a read-only helper was required to satisfy the MCP
  server's read-only guarantee.
- The smoke workspace was seeded directly through the memory package because
  the sandbox could not find an available loopback runtime port during this
  run. The MCP server itself does not require the HTTP runtime.

### Verification Run

- `bun run typecheck` - PASS
- `bun run build` - PASS
- `git diff --check` - PASS
- `bun test` - SKIPPED (repo has no test files yet; Bun exits 1)
- `WARD_HOME=/tmp/ward-task009f-smoke WARD_SECRET_BACKEND=file bun run ward --json init` - PASS
- Direct memory workspace seed in `/tmp/ward-task009f-smoke` - PASS
- `WARD_HOME=/tmp/ward-task009f-smoke WARD_SECRET_BACKEND=file WARD_REPO_ROOT=/Users/eleazarjunsan/Code/Personal/ward bun run ward --json mcp smoke-serve` - PASS

## Quality Gate Notes

### Result

PASS

### Standards Review

- No blocking issues found in the changed files.
- The advertised MCP tool list contains only the approved read-only
  `ward.*` tools; no mutation-like commands are exposed through
  `tools/list`.
- Non-status tools check the session token before calling WARD memory
  helpers, while `ward.status` remains intentionally tokenless for worker
  status pings.
- Output shaping is centralized through recursive redaction and bounded
  strings, arrays, and object depth before results are returned to MCP
  clients.
- `ward.get_workspace` uses a new read-only helper instead of the existing
  detail helper that updates `last_opened_at`.
- The CLI smoke command validates the protocol path end to end without
  requiring the HTTP runtime.

### Deviations

- Minor: `packages/memory/src/repositories.ts` was added to the touched file
  set to preserve the read-only guarantee. This avoids reusing
  `getWorkspaceDetail`, which updates workspace recency.
- Minor: the session token is scoped to the `ward mcp-serve` process through
  `--token` or environment variables, but there is no separate token minting
  or expiry command in this slice. That keeps 009F local and stdio-only;
  harness-issued short-lived tokens can build on this contract later.
- Minor: the smoke workspace was seeded directly through memory because the
  sandbox could not allocate a loopback HTTP runtime port. This does not
  affect MCP behavior because `ward mcp-serve` reads local WARD state
  directly.

### Required Fixes

- None.
