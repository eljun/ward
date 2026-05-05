# Task 009E: MCP Tool Proxy and Circuit Breakers

- Status: `testing`
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

## Implementation Notes

### What Changed

- Added MCP tool invocation, result, synthetic unavailable, and breaker status
  contracts.
- Added stdio `tools/call` support by reusing the 009C initialize flow.
- Added fixture `tools/call` support plus deterministic failure modes.
- Added `callMcpToolThroughProxy` to enforce the 009D policy decision before
  dispatch.
- Added quota-backed MCP server circuit breakers using `quota_ledger` rows
  for failure windows and freeze/unfreeze state.
- Added redacted `mcp.tool_invoked`, `mcp.tool_result`, and
  `mcp.tool_denied` system events.
- Added `POST /api/mcp/call`, `ward mcp call`, `POST /api/quota/unfreeze`,
  and `ward quota unfreeze`.

### Files Changed

- `packages/core/src/mcp/index.ts` - invocation/result/breaker schemas.
- `packages/memory/src/mcp-client.ts` - stdio `tools/call` helper.
- `packages/memory/src/mcp-fixture-server.ts` - fixture call result and
  failure modes.
- `packages/memory/src/mcp-proxy.ts` - proxy, policy gate, breaker,
  redaction, events, and unfreeze helper.
- `packages/memory/src/index.ts` - proxy exports.
- `apps/runtime/src/index.ts` - MCP call and quota unfreeze API routes.
- `apps/cli/src/main.ts` - `ward mcp call` and `ward quota unfreeze`.
- `docs/task/009-mcp-connections.md` and `TASKS.md` - slice tracking.

### Deviations From Plan

- None. This slice remains stdio-only and does not add UI approval,
  long-lived server pools, HTTP invocation, or WARD-as-MCP-server.

### Verification Run

- `bun run typecheck` - PASS
- `bun run build` - PASS
- `git diff --check` - PASS
- `bun test` - SKIPPED (repo has no test files yet; Bun exits 1)
- `WARD_HOME=/tmp/ward-task009e-smoke WARD_SECRET_BACKEND=file bun run ward --json init` - PASS
- Fixture `ward mcp call fixture fixture.read_context ...` allowed smoke - PASS
- Fixture allowlist denial returns synthetic `tool_not_allowed` - PASS
- Destructive `repos.delete` under `standard` is denied before dispatch - PASS
- Forced fixture call failures open the breaker after three failures - PASS
- Open breaker returns synthetic `server_unavailable` - PASS
- `ward quota unfreeze mcp_server fixture-fail` clears the open breaker - PASS
- `ward quota list --limit 12` shows MCP failure/freeze/unfreeze rows - PASS
- MCP event payload inspection shows redacted token values - PASS
- Fixture stderr log redaction check - PASS
- `WARD_HOME=/tmp/ward-task009e-smoke WARD_SECRET_BACKEND=file bun run ward --json down` - PASS

## Quality Gate Notes

### Result

PASS

### Standards Review

- No blocking issues found in the changed files.
- Invocation, result, unavailable, and breaker contracts stay typed through
  shared core schemas.
- The proxy checks policy and breaker state before dispatch, then records
  redacted events for invoked, result, and denied paths.
- The new CLI and runtime surfaces are scoped to debug/smoke MCP calls and
  quota unfreeze; no UI approval, HTTP invocation, or long-lived pool scope
  leaked into this slice.

### Deviations

- Minor: `callStdioMcpTool` repeats the small JSON-RPC initialize loop used
  by the probe helper. This is acceptable for the stdio-only MVP and can be
  extracted if future HTTP/pool work increases the shared transport surface.
- Minor: manual unfreeze clears the active freeze row but preserves recent
  failure rows in `quota_ledger` for auditability. A server that immediately
  fails again inside the rolling window can reopen quickly, which matches the
  safety intent.

### Required Fixes

- None.
