# Task 009E: MCP Tool Proxy and Circuit Breakers

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 009D
- Recommended Tier: `deep`

## Overview

Add the runtime proxy that dispatches MCP tool calls through WARD policy.
Every call goes through allowlist/autonomy checks, server availability checks,
failure accounting, circuit breaker state, redacted event logging, and a
synthetic denial/unavailable result when WARD refuses or freezes a call.

## Requirements

- Add a tool invocation request/response contract.
- Add proxy function for stdio MCP tool calls.
- Reuse lifecycle/doctor client code from 009C.
- Reuse classification/autonomy policy from 009D.
- Record `mcp.tool_invoked`, `mcp.tool_result`, and `mcp.tool_denied`.
- Add per-server failure-rate circuit breaker using `quota_ledger`.
- Return synthetic `server_unavailable` while breaker is open.
- Add `ward quota unfreeze` for MCP server freeze state.
- Add `ward mcp call <server> <tool> --json-args <json>` for smoke/debug.
- Keep all payloads redacted before event/log output.

## Out of Scope

- UI approval flow for destructive/privileged tools.
- Full long-lived server pool optimization.
- HTTP MCP server invocation.
- WARD-as-MCP-server.
- Browser screenshot evidence capture.

## Proposed File Changes

- `packages/core/src/mcp/index.ts` - Add invocation, result, and breaker
  schemas.
- `packages/memory/src/mcp-client.ts` - Add `tools/call` support.
- `packages/memory/src/mcp-policy.ts` - Reuse policy decision helpers.
- `packages/memory/src/mcp-proxy.ts` - Add proxy, event, redaction, and
  breaker orchestration.
- `packages/memory/src/brains.ts` or a new quota helper - Add MCP breaker
  quota records and unfreeze helper.
- `apps/runtime/src/index.ts` - Add MCP call and quota unfreeze routes.
- `apps/cli/src/main.ts` - Add `ward mcp call` and `ward quota unfreeze`.
- `docs/task/009-mcp-connections.md` - Record slice notes.
- `TASKS.md` - Track 009E.

## Code Context

- `quota_ledger` already exists from Task 008 in
  `packages/memory/migrations/0008_cost_ledger.sql`.
- `listQuotaLedger` exists in `packages/memory/src/brains.ts`.
- Event taxonomy for MCP events is in `docs/task/001/event-taxonomy.md`.
- Existing runtime APIs already protect endpoints with the device token.

## Implementation Steps

1. Add invocation/result/breaker schemas.
2. Add `tools/call` to the stdio MCP client.
3. Implement proxy policy checks.
4. Add circuit breaker accounting and open/half-open/closed decisions.
5. Add event recording with redaction.
6. Add CLI/API smoke surfaces.
7. Verify denied, allowed, and frozen paths with fixture server.
8. Update docs and task tracking.

## Acceptance Criteria

1. Allowed read call reaches fixture MCP server and returns tool result.
2. Disallowed tool returns synthetic `tool_not_allowed`.
3. Destructive tool under `standard` is denied before dispatch.
4. Repeated fixture failures open the circuit breaker.
5. Open breaker returns synthetic `server_unavailable`.
6. Manual unfreeze clears the frozen state.
7. MCP event payloads do not include raw secret values.
8. Typecheck/build/diff checks pass.

## Verification

- `bun run typecheck`
- `bun run build`
- `git diff --check`
- fixture server `tools/call` allowed smoke
- fixture server denial smoke
- forced failure smoke to open breaker
- `ward quota unfreeze` smoke
- inspect quota ledger and MCP events for redaction

