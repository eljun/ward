# Task 008A: Command Center Navigation Layout

- Status: `in_progress`
- Type: `enhancement`
- Version Impact: `minor`
- Priority: `medium`
- Depends on: 008
- Recommended Tier: `fast`

## Overview

The Command Center has grown from a small health shell into several real
workflow surfaces. The user clarified that the desired first screen is not a
dashboard or tabbed control room. It should feel like a minimal command orb:
WARD centered, animated/reactive core interaction, bottom voice/chat dock,
sessions behind a top-left drawer, and supporting surfaces behind a top-right
settings menu.

## Requirements

- Use a centered command-orb home instead of a dashboard-first layout.
- Use top-left Sessions drawer toggle.
- Use top-right settings/menu dropdown for Overview, Workspaces, Planning,
  Memory, Settings, and refresh.
- Add a Three.js orb that animates continuously and reacts to hover and chat
  submission.
- Add a bottom voice/chat dock with a rounded Speak CTA.
- Move the visual direction toward a restrained glassmorphic console:
  translucent panels, soft shadow, clean borders, modern/techy but still
  dense and operational.
- Add a Tailwind CSS + shadcn-style foundation so future UI polish uses local
  composable primitives instead of only global CSS.
- Preserve all existing forms, actions, API calls, and state.
- Keep the UI local-first, dense, and operational.
- Keep the implementation UI-only unless a tiny API issue is discovered.

## Out of Scope

- New runtime routes or migrations.
- Dedicated Settings -> Brains or Cost Dashboard screens.
- Deep sidebar navigation.
- A complete design system, icon pass, or animation system.

## Code Context

- `apps/ui/src/main.tsx`
  - Current Command Center surfaces are already present as separate grid
    sections in one long page.
  - The side task should add a view state and render one surface at a time.
- `apps/ui/src/styles.css`
  - Existing panel/grid styles should be reused.
  - Add compact tab styling and responsive grid support.

## Implementation Notes

- Added a `CommandView` state in the React app.
- Replaced the dashboard-first tab strip with a centered WARD orb home.
- Added a top-left Sessions drawer and top-right command menu.
- Moved Profile into Settings and grouped Workspaces, Tasks, and Attachments
  into a focused Workspaces panel.
- Left Planning, Sessions, and Memory behavior unchanged except for being
  rendered inside drawers.
- Updated the visual shell toward a glassy, clean, modern console treatment
  using translucent surfaces, subtle depth, and restrained teal accents.
- Added Tailwind through the Vite plugin, local shadcn-style `Button`,
  `Badge`, and `Card` primitives, and a `cn()` utility.
- Added `lucide-react` icons for primary navigation and refresh actions.
- Added `three` and `@types/three` for the animated WARD command orb.

## Acceptance Criteria

1. Command Center opens to the centered WARD orb by default.
2. Top-left Sessions opens the sessions drawer.
3. Top-right menu opens supporting surfaces without page reload.
4. Workspaces, Planning, Sessions, Memory, and Settings retain their existing
   controls.
5. The Three.js orb renders non-blank and reacts to hover/chat pulses.
6. The layout remains usable on mobile width through responsive drawer/grid
   collapse.
7. Typecheck and production build pass.

## Verification

- `bun run typecheck`
- `bun run build`
- `git diff --check`
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json up`
- local runtime UI root returns 200 and serves the tabbed Vite bundle
- `WARD_HOME=/tmp/ward-task008-smoke bun run ward --json down`
