# Task 008B: Orb Chat Command Loop

- Status: `in_progress`
- Type: `enhancement`
- Version Impact: `minor`
- Priority: `medium`
- Depends on: 008A
- Recommended Tier: `fast`

## Overview

The WARD orb UI has a bottom chat/speak dock, but the first implementation
only pulsed the orb and echoed that a message was heard. Add the first real
local-first command loop so submitted text receives a WARD reply and can open
the relevant WARD surface.

## Requirements

- Add a runtime endpoint for orb chat.
- Keep the first reply loop deterministic and local-first.
- Do not call Claude, Codex, or API models in this slice.
- Reply with useful status based on current WARD state:
  - sessions / agents
  - memory / wiki
  - planning
  - workspaces / tasks
  - settings / voice
  - overview / daily brief
- Render a compact transcript under the orb dock.
- Pulse the orb on send and reply.
- Use the detected surface to open the corresponding drawer.
- Speak CTA should read the latest WARD reply when available.

## Out of Scope

- Streaming LLM responses.
- Durable chat history.
- Brain routing through Claude/Codex/local models.
- New database migrations.
- Tool execution from chat.

## Implementation Notes

- Added `POST /api/orb/chat`.
- Runtime replies are deterministic and derived from current profile,
  overview, workspaces, tasks, and harness sessions.
- The UI keeps an in-memory transcript for the current page session.
- Reply surface routing opens Sessions via the left drawer or supporting
  surfaces through the right drawer.

### What Changed

- Added the local orb chat runtime endpoint and intent routing.
- Wired the bottom orb dock to submit real messages and render recent turns.
- Updated Speak so it reads the latest WARD reply when available.
- Documented the slice in `TASKS.md`.

### Files Changed

- `apps/runtime/src/index.ts` - Adds deterministic orb chat replies and the
  authenticated API route.
- `apps/ui/src/main.tsx` - Adds orb chat state, submission, transcript
  rendering, and surface routing.
- `apps/ui/src/styles.css` - Adds compact glass transcript styling.
- `TASKS.md` - Tracks Task 008B and verification coverage.

### Deviations From Plan

- None.

### Verification Run

- `bun run typecheck` - PASS
- `bun run build` - PASS
- `git diff --check` - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json up` - PASS
- authenticated `POST /api/orb/chat` for overview, sessions, memory,
  planning, workspaces, and settings intents - PASS
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json down` - PASS

## Acceptance Criteria

1. Sending text in the orb dock returns a visible WARD reply.
2. Session-related text opens the Sessions drawer.
3. Memory/planning/workspace/settings text opens the matching support drawer.
4. Speak reads the latest WARD reply when one exists.
5. Typecheck and production build pass.

## Verification

- `bun run typecheck`
- `bun run build`
- `git diff --check`
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json up`
- authenticated `POST /api/orb/chat` returns a deterministic WARD reply
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json down`
