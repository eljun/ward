# Task 009F: WARD as a Read-Only MCP Server

- Status: `planned`
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

