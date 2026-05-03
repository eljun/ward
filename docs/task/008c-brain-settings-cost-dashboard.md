# Task 008C: Brain Settings and Cost Dashboard

- Status: `done`
- Type: `enhancement`
- Version Impact: `minor`
- Priority: `medium`
- Depends on: 008
- Recommended Tier: `fast`

## Overview

Task 008 added the Brain Registry, routes, quota ledger, cost ledger, and
CLI surfaces. The Command Center still needs an inspectable local UI for
those controls so WARD can be operated without remembering CLI commands.

## Requirements

- Add Settings visibility for all registered brains.
- Show enabled/off state, runtime, auth mode, accounting mode, tags, and
  concurrency cap.
- Allow enabling and disabling brains from the UI.
- Show routing concerns and allow route updates.
- Show today's total cost/usage rollup.
- Show per-brain invocations, duration, token/cost placeholders, and forecast
  status.
- Show recent quota ledger entries.
- Keep this UI backed by existing Task 008 APIs; no new migration.

## Out of Scope

- Full historical 7-day trend charts.
- Budget-cap preferences editor.
- SDK/API/local model execution.
- New Brain Registry schema fields.

## Implementation Notes

- Extended the Settings surface with Brains, Routing, Cost Today, and Quota
  Ledger panels.
- Reused existing `/api/brains`, `/api/brains/routes`, `/api/cost/today`,
  `/api/cost/forecast`, and `/api/quota` endpoints.
- Added in-place brain enable/disable actions and a multi-select route editor.

### Files Changed

- `apps/ui/src/main.tsx` - Adds registry/cost/quota state, refresh logic,
  mutation handlers, and Settings panels.
- `apps/ui/src/styles.css` - Adds compact glass UI styles for brain controls,
  routing rows, cost metrics, and quota rows.
- `TASKS.md` - Tracks the Task 008C slice and moves 008A/008B to Done.

### Verification Run

- `bun run build` - PASS
- `git diff --check` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json up` - PASS
- authenticated Settings backing API smoke - PASS
  - `/api/brains`
  - `/api/brains/<id>/enable`
  - `/api/brains/<id>/disable`
  - `/api/brains/routes/recap_and_brief`
  - `/api/cost/today`
  - `/api/cost/forecast`
  - `/api/quota?limit=8`
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json down` - PASS

## Acceptance Criteria

1. Settings shows every registered brain and its current enabled state.
2. Brain enable/disable actions persist through the existing API.
3. Routing rows show current concerns and can save selected brains.
4. Cost Today shows total and per-brain usage.
5. Quota Ledger shows recent entries when present.
6. Typecheck and production build pass.
