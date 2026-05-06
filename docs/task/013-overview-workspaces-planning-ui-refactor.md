# Task 013: Overview, Workspaces, and Planning UI Refactor

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 008A, 005, 003, 006
- Recommended Tier: `balanced`

## Overview

Replace the cluttered three-column "show everything at once" layouts in the
Overview, Workspaces, and Planning views with a simple, modern, minimalistic
UI. The current layouts expose every panel up front — including ones that
are visibly disabled until a workspace or plan packet is selected — which
makes the dashboard hard to navigate, hides the next action, and undermines
testability.

This task is UI-only. It does not change runtime APIs, schemas, or data
flow. The Sessions, Memory, and Settings views are out of scope for this
task and will be revisited after these three are stable.

## Requirements

### Cross-cutting

- Remove or strongly tone down the orb/glassy backdrop bleed inside content
  panels (keep it on the home/orb shell, not behind dense forms).
- Add a pending/disabled/spinner state to every action button so the user
  can tell a click was registered.
- Add a non-blocking confirmation toast (or inline confirmation) on
  successful create/update/delete; surface server errors inline.
- Replace empty-state `0` counts with informative copy
  (e.g. "No workspaces yet — create your first to begin").
- Replace the ambiguous top-right `×` button with a labeled "Close" /
  "Back to Home" affordance, or remove it where the orb shell already
  provides navigation.
- Ensure desktop and narrow-width layouts both work (no horizontal
  overflow, no text truncation in pills/labels).

### Overview

- Reorganize into a clean greeting block, a stats grid, and an actions
  section.
- Greeting block: shows display name, local date, and the warm narration
  paragraph as a single readable block (not a horizontal strip).
- Stats grid: workspaces, open tasks, blockers, handoffs as four equal
  cards with icons and a clear primary number; cards may link into the
  matching view.
- Actions: the existing Speak / Test / Warm buttons must be relabeled or
  grouped so their purpose is obvious
  (e.g. "Speak brief", "Speak test phrase", "Refresh warm cache").
- "Next" and "Handoffs" lists become two side-by-side cards under the
  stats grid, each with its own empty state copy.

### Workspaces

- Adopt a master-detail layout:
  - Left rail: list of workspaces with a "+ New workspace" affordance
    (form may live in a small dialog/popover or inline at the top of the
    rail). Selected workspace is visually emphasized.
  - Right detail: shows the selected workspace's metadata, then tabs (or
    stacked sections) for Tasks and Attachments.
- The Tasks form must give the title input enough room that the
  placeholder is fully visible at narrow widths.
- Empty state in the rail: clear copy + a primary "Create workspace" call
  to action.
- Empty state in detail: shown only when a workspace is selected but has
  no tasks/attachments yet, with the matching "+ Add task" / "+ Attach"
  call to action.
- Hide Tasks and Attachments entirely when no workspace is selected; show
  a friendly placeholder in the detail pane instead.

### Planning

- Adopt progressive disclosure:
  - When no plan packet exists for the selected workspace, show a single
    centered "Start a plan" card with the prompt input, policy selector,
    Clarify checkbox, and Start button. Code Context refresh lives below
    or behind a secondary affordance.
  - When at least one plan exists, show the existing list rail on the
    left, the active packet detail in the center, and Participants on
    the right (or stacked at narrow widths).
- Round pills must display each round name in full
  (no truncation of "convergence").
- The Participants column is hidden until a packet has rounds.
- The Decision Review action row (Approve / Generate Tasks / Reload /
  Revise) groups primary vs. secondary actions, and disabled buttons get
  a tooltip or helper text explaining why they are unavailable.
- Empty state in Decision Review is a single short message plus a "Start
  a plan" CTA — not a row of dead disabled buttons.

## Out of Scope

- Sessions view refactor.
- Memory view refactor.
- Settings (including Connections) refactor — recently shipped in 009G.
- New backend or runtime APIs. UI must reuse existing endpoints.
- New features. This is purely a UX refactor of three existing views.
- Theme / dark-mode toggle.
- Animation framework introduction (CSS transitions are fine; no Framer
  Motion etc.).
- Component library swap (e.g. introducing shadcn) — keep the existing
  component approach unless a swap is trivially needed.

## Proposed File Changes

- `apps/ui/src/main.tsx`
  - Refactor the `activeView === "overview"` block: greeting, stats grid,
    next/handoffs cards, relabeled action buttons.
  - Refactor the `activeView === "workspaces"` block: master-detail
    layout, hide Tasks/Attachments until a workspace is selected, fix
    task title input width, add empty-state copy.
  - Refactor the `activeView === "planning"` block: progressive
    disclosure, fix round pill truncation, group plan actions, hide
    Participants until a packet has rounds.
  - Add a small reusable button component or hook for pending/disabled
    state if the same logic recurs (only if it removes duplication).
  - Add a small toast surface (single state var + render slot) for
    success messages; reuse existing `setMessage` if practical.

- `apps/ui/src/styles.css`
  - Add classes for the new master-detail Workspace layout, the
    Overview greeting block, the Planning start-card, and the round pill
    layout (no truncation).
  - Tone down `.panel` backdrop blur / orb bleed for the three refactored
    views (do not change the home/orb shell styling).
  - Add `.btn-pending` / spinner styles, toast styles, and consistent
    empty-state styles.
  - Verify responsive breakpoints (e.g. ≤ 960 px collapses the master-
    detail rail above the detail pane and the Planning Participants
    section below).

- No runtime, CLI, or schema changes.

## Code Context

- Current Overview block: `apps/ui/src/main.tsx` ~line 1914 (`activeView === "overview"`).
- Current Workspaces block: `apps/ui/src/main.tsx` ~line 2319 (`activeView === "workspaces"`).
- Current Planning block: `apps/ui/src/main.tsx` ~line 2399 (`activeView === "planning"`).
- Existing handlers to keep wiring: `createWorkspace` (line 1391),
  `createTask` (line 1407), `uploadAttachment`, `startPlan`,
  `clearPlans`, `readPlan`, `approvePlanPacket`, `generatePlanTasks`,
  `revisePlanPacket`, `answerPlan`, `refreshCodeContext`, `warmNow`,
  `speak`.
- Existing state: `workspaces`, `selectedSlug`, `selectedWorkspace`,
  `detail`, `tasks`, `plans`, `selectedPlanId`, `planDetail`,
  `planBusy`, `latestRound`, `repoSnapshots`, `latestSnapshot`,
  `overview`.
- The orb shell, top-left Sessions drawer, and top-right command menu
  from 008A are out of scope but the views are rendered inside that
  shell; existing classnames `surface-drawer`, `command-orb`, etc.
  must keep working.
- Keep React components; do not introduce a new framework or
  state-management library.

## Implementation Steps

1. Refactor the Overview view:
   - Restructure greeting block, stats grid, and actions.
   - Relabel Speak / Test / Warm.
   - Wire pending/spinner state on Speak/Test/Warm.
2. Refactor the Workspaces view:
   - Build master-detail layout (left rail + detail).
   - Hide Tasks/Attachments until a workspace is selected.
   - Fix Task title input width.
   - Add empty-state copy.
   - Add pending state to Create / Add / Attach buttons.
3. Refactor the Planning view:
   - Build progressive disclosure: start-card vs. active-list state.
   - Fix round pill truncation.
   - Group Approve / Generate Tasks / Reload / Revise; add helper text
     on disabled buttons.
   - Hide Participants until rounds exist.
4. Add cross-cutting polish:
   - Toast surface for success messages.
   - Tone down backdrop blur on the three refactored views.
   - Replace the ambiguous `×` button with labeled / Back-to-Home
     affordance, or remove if redundant with the orb shell.
5. Verify responsive layout at desktop and narrow widths.
6. Run typecheck/build/diff and a manual UI smoke against the running
   runtime; capture before/after screenshots in the implementation
   notes.
7. Update task tracking and document deviations from plan.

## Acceptance Criteria

1. Overview greeting block reads as a single coherent paragraph (not a
   horizontal strip), and stat cards are clearly labeled with counts.
2. Speak / Test / Warm buttons have descriptive labels and visible
   pending states while running.
3. Workspaces view uses a master-detail layout; Tasks and Attachments
   are hidden when no workspace is selected.
4. Workspaces task title input shows its full placeholder at the
   default and narrow widths.
5. Planning view shows a single "Start a plan" entry point when no
   packet exists for the selected workspace.
6. Planning view round pills render `convergence` and `decision` with
   no text truncation.
7. Disabled action buttons across all three views provide a hint
   (tooltip, helper text, or contextual empty state) about why they
   are disabled.
8. Successful create/update/delete actions surface a non-blocking
   confirmation; failures surface a clear error message.
9. The orb glow does not visibly bleed through content panels in the
   refactored views.
10. The top-right `×` is replaced with a labeled affordance or removed
    in favor of existing orb-shell navigation.
11. All refactored views layout cleanly at desktop and narrow widths
    (no horizontal overflow, no overlapping panels).
12. `bun run typecheck`, `bun run build`, and `git diff --check` pass.

## Verification

- `bun run typecheck`
- `bun run build`
- `git diff --check`
- Manual UI smoke against the running runtime:
  - Open `http://127.0.0.1:47730/`.
  - Overview: confirm greeting block, stats, action labels, pending
    state on Speak/Test/Warm.
  - Workspaces: create a workspace, select it, add a task, attach a
    file; confirm master-detail behavior, empty states, and that the
    task title input shows its full placeholder.
  - Planning: with no packet, confirm the start card; start a plan and
    confirm the active layout, full-text pills, and grouped actions.
  - Confirm no overlapping panels and no orb bleed-through inside
    content panels.
- Capture before/after screenshots of each view for the implementation
  notes.

## Implementation Notes

_To be filled in by the implementation stage._
