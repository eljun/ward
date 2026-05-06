# Task 009G: Settings Connections UI

- Status: `done`
- Type: `feature`
- Version Impact: `minor`
- Priority: `medium`
- Depends on: 009F
- Recommended Tier: `balanced`

## Overview

Add a Connections surface to WARD's Settings menu so MCP configuration is
inspectable without dropping into raw JSON. This UI should expose effective
connections, scoped config tabs, conflict information, server health, tool
counts, capability profiles, and safe enable/disable controls while keeping
secret values out of the browser.

## Requirements

- Add Settings -> Connections surface.
- Show Global, Workspace, Repo, and Effective views.
- Show each server id, scope, origin path, enabled state, transport, command
  or URL summary, tool scopes, capability profiles, and latest status.
- Show conflict warnings from effective config.
- Show doctor/status results from 009C.
- Allow enable/disable for global/workspace servers.
- Keep repo scope read-only with a clear path to `.mcp.json`.
- Do not display raw secrets.
- Keep layout consistent with the existing orb/glassy UI direction.

## Out of Scope

- Full interactive server creation wizard.
- Secret value editing in the UI.
- Destructive tool approval UI.
- Real-time streaming logs.

## Proposed File Changes

- `apps/ui/src/main.tsx` - Add Connections panel state, fetchers, and views.
- `apps/ui/src/styles.css` - Add responsive Connections styles.
- `apps/runtime/src/index.ts` - Add any small read route needed by the UI
  if existing MCP routes are insufficient.
- `docs/task/009-mcp-connections.md` - Record slice notes.
- `TASKS.md` - Track 009G.

## Code Context

- Settings panel currently lives in `apps/ui/src/main.tsx`.
- Existing Settings already fetches Brain Registry, cost, budget, and quota
  data through runtime APIs.
- MCP APIs already include effective config and scoped config routes from
  009A, with server status expected from 009C.
- UI design should follow the current WARD command-orb/glassy surface and
  avoid dense nested cards.

## Implementation Steps

1. Add MCP/Connections state types in the UI.
2. Fetch effective config, scoped config, and server statuses.
3. Add Connections section inside Settings.
4. Render scope tabs and conflict summaries.
5. Add enable/disable controls for editable scopes.
6. Add empty/error/loading states.
7. Run browser smoke against the local runtime.
8. Update docs and task tracking.

## Acceptance Criteria

1. Settings exposes a Connections surface.
2. Effective view shows merged servers and conflict warnings.
3. Global/workspace views show editable enabled state.
4. Repo view is read-only and displays origin path.
5. Status/tool counts appear when available.
6. No secret values are shown in the UI.
7. Layout works on desktop and narrow widths.
8. Typecheck/build/diff checks pass.

## Verification

- `bun run typecheck`
- `bun run build`
- `git diff --check`
- runtime smoke with fixture MCP config
- browser smoke of Settings -> Connections
- manual check that `secret://` references remain references/redacted

## Implementation Notes

### What Changed

- Added a Settings Connections panel that fits the current glassy WARD
  command center style.
- Added Effective, Global, Workspace, and Repo MCP scope views.
- Added Connections summary metrics for enabled servers, healthy statuses,
  discovered tools, and conflicts.
- Added MCP search/filter across server id, scope, origin, transport, status,
  tool scopes, capability profiles, and discovered tool names.
- Rendered each server with enabled state, doctor/status badge, transport
  summary, origin path, scopes, capability profiles, tool count, tool preview,
  conflict warning, and error detail.
- Added safe enable/disable controls for global/workspace servers while repo
  rows remain read-only.
- Added Refresh and Doctor actions that use the existing 009A/009C MCP
  runtime APIs.
- Avoided displaying env/header values or raw args in the UI; command
  summaries show command plus arg count, and URL summaries strip query
  strings.

### Files Changed

- `apps/ui/src/main.tsx` - MCP types, Connections state/fetchers, scope tabs,
  server list, search, doctor action, and enable/disable controls.
- `apps/ui/src/styles.css` - responsive Connections layout and row styles.
- `docs/task/009-mcp-connections.md` and `TASKS.md` - slice tracking.

### Deviations From Plan

- No runtime route was needed; existing MCP effective, scoped config, server
  status, doctor, and patch routes were sufficient.
- Browser/runtime smoke could not run in this sandbox because loopback port
  binding is unavailable during this run; `isPortAvailable` returned false
  for the WARD range and high test ports. The direct fixture MCP config smoke
  verified the underlying data returned to the UI.

### Verification Run

- `bun run typecheck` - PASS
- `bun run build` - PASS
- `git diff --check` - PASS
- `bun test` - SKIPPED (repo has no test files yet; Bun exits 1)
- `WARD_HOME=/tmp/ward-task009g-smoke WARD_SECRET_BACKEND=file bun run ward --json init` - PASS
- Direct memory workspace seed in `/tmp/ward-task009g-smoke` - PASS
- Direct fixture MCP server config with `secret://fixture-token` - PASS
- Direct effective/scoped config + `runMcpDoctor` smoke - PASS
- Runtime/browser smoke - SKIPPED (sandbox cannot bind loopback ports)
