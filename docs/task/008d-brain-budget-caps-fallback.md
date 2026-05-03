# Task 008D: Brain Budget Caps and Fallback

- Status: `done`
- Type: `enhancement`
- Version Impact: `minor`
- Priority: `medium`
- Depends on: 008C
- Recommended Tier: `fast`

## Overview

Task 008 records cost and quota rows, but launch routing still needs a guard
that checks per-brain daily caps before a session is queued. Add the first
budget policy layer using existing preferences, the Brain Registry fallback
route, and the Settings UI.

## Requirements

- Store per-brain daily invocation and dollar caps as global preferences.
- Expose budget status through the runtime API and CLI.
- Show/edit budget caps in Settings → Brains.
- Include cap limits in cost forecasts.
- Check the selected brain before queuing a harness session.
- If the selected brain is over cap, fall back to the first enabled,
  within-budget brain from `budget_exceeded_fallback`.
- If no fallback is available, reject launch with a clear error.
- Record fallback details in the session-created event payload.

## Out of Scope

- Historical budget trends.
- Per-workspace or per-channel caps.
- MCP circuit breaker enforcement.
- API token pricing tables.

## Implementation Notes

- Added Brain Budget schemas to `@ward/core`.
- Added budget preference readers/writers and budget resolution helpers in
  memory.
- Added runtime routes for budget list, read, and patch.
- Added `ward brain budget` CLI support.
- Added Settings budget cap inputs for each registered brain.
- Added launch-time budget resolution in `prepareHarnessLaunch`.

### Files Changed

- `packages/core/src/brains/index.ts` - Adds budget patch/status/decision
  schemas.
- `packages/memory/src/brains.ts` - Adds budget status, cap persistence,
  fallback resolution, and cap-aware forecast limits.
- `packages/memory/src/sessions.ts` - Applies budget resolution before a
  session is queued.
- `apps/runtime/src/index.ts` - Adds budget API routes.
- `apps/cli/src/main.ts` - Adds `ward brain budget`.
- `apps/ui/src/main.tsx` - Adds Settings budget status and cap forms.
- `apps/ui/src/styles.css` - Adds budget form layout.
- `TASKS.md` - Tracks the Task 008D slice.

### Verification Run

- `bun run build` - PASS
- `git diff --check` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json up` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json brain budget claude-code-cli --daily-invocations 1` - PASS
- synthetic cost entry recorded for `claude-code-cli` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json brain budget claude-code-cli` - PASS
  (`allowed: false`, exceeded `daily_invocations`)
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json cost forecast` - PASS
  (forecast includes `limit: 1`, `status: watch`)
- over-cap `claude-code-cli` launch fell back to `stub-worker` before
  queuing - PASS
- no-fallback over-cap launch rejected with `Brain budget exceeded...` - PASS
- cap reset and `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json down` - PASS

## Acceptance Criteria

1. `ward brain budget <brain-id>` reads current budget status.
2. `ward brain budget <brain-id> --daily-invocations <n>` persists a cap.
3. Cost forecast reports limits when caps exist.
4. Launching an over-cap brain falls back to `budget_exceeded_fallback` when
   an enabled within-budget fallback exists.
5. Launching an over-cap brain rejects clearly when no fallback exists.
6. Settings can save and clear budget caps.
7. Typecheck and production build pass.
