# Task 008E: Workflow Skills Bridge and QA Supervisor Stub

- Status: `done`
- Type: `enhancement`
- Version Impact: `minor`
- Priority: `medium`
- Depends on: 008D
- Recommended Tier: `fast`

## Overview

Task 008 has real CLI adapters, Brain Registry, cost tracking, budget caps,
and a clearer operator UI. The remaining phase-1 gap is the workflow bridge:
WARD needs to record durable phase signals from the existing workflow-skills
shape and run a deterministic QA Supervisor pass over task evidence.

## Requirements

- Add a structured `AgentSignal` contract.
- Add a workflow phase command/API for task, implement, simplify, test,
  document, ship, and release.
- Persist each signal as a durable artifact.
- Record task events for each signal.
- Add a deterministic QA Supervisor review command/API.
- QA Supervisor writes an evidence packet artifact.
- QA Supervisor rejects thin evidence when acceptance criteria lack matching
  direct evidence.
- Keep this slice local-first and model-free.

## Out of Scope

- Actually invoking external `/task`, `/implement`, `/test`, or other skill
  runtimes.
- Multi-agent scheduling.
- Browser automation.
- LLM-based critique.

## Implementation Notes

- Added `AgentSignal`, workflow phase, and QA Supervisor schemas.
- Added memory repository helpers for workflow signal persistence and QA
  review.
- Added runtime routes:
  - `POST /api/tasks/:id/signals`
  - `POST /api/tasks/:id/qa-review`
- Added CLI commands:
  - `ward workflow signal <task-id> --phase <phase>`
  - `ward workflow qa <task-id>`
- QA Supervisor writes `~/.ward/workspaces/<workspace>/evidence/<task>.json`
  and links it as a task artifact.

### Files Changed

- `packages/core/src/schemas.ts` - Adds workflow and QA schemas.
- `packages/memory/src/repositories.ts` - Adds signal persistence and QA
  review helpers.
- `apps/runtime/src/index.ts` - Adds workflow and QA API routes.
- `apps/cli/src/main.ts` - Adds `ward workflow` commands.
- `TASKS.md` - Tracks the Task 008E slice.

### Verification Run

- `bun run typecheck` - PASS
- `bun run build` - PASS
- `git diff --check` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json up` - PASS
- created a contracted workflow smoke task with one acceptance criterion - PASS
- `ward workflow signal <task-id> --phase task --status done` - PASS
- `ward workflow signal <task-id> --phase implement --status done` - PASS
- `ward workflow signal <task-id> --phase test --status pass` - PASS
- `ward workflow qa <task-id>` without direct evidence - PASS
  (`needs_work`, missing `AC1`)
- attached a matching `test_report` artifact and reran `ward workflow qa` - PASS
  (`pass`, evidence packet persisted)
- task detail shows agent-signal artifacts and latest evidence packet path - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json down` - PASS

## Acceptance Criteria

1. Workflow phase signals can be recorded for task, implement, and test.
2. Each signal is persisted as an artifact and returned in task events.
3. QA Supervisor writes an evidence packet.
4. QA Supervisor returns `needs_work` when an acceptance criterion has no
   matching evidence artifact.
5. QA Supervisor can pass when a test signal and matching evidence exist.
6. Typecheck and production build pass.
