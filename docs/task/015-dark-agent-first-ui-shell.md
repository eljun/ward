# Task 015: Dark Agent-First UI Shell with Live Updates

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 008A, 008B, 014, 005, 003, 008C
- Recommended Tier: `balanced`

## Overview

Replace WARD's current light, cluttered home with a dark, minimal,
"engineering / space-exploration" UI centered on the orb. Move every
surface except the home conversation into either a Settings glass modal
(Standard / Advanced tabs) or a Cmd+K command palette. Reorganize the
agents in Settings around their **role** (Harness, Orchestrator, Stub),
not the brain registry's flat list. Make data updates seamless across
the app — no manual page refresh needed to see new sessions, task
updates, or workspace changes.

The user's explicit pain points:

- "I never heard WARD utter a word" — fixed in 014; this task amplifies
  the orb so it feels alive while WARD speaks.
- "Sometimes saving items or sessions updates I have to REFRESH the
  page in order to see the updates this needs to be seamless." Live
  updates are a first-class requirement of this task.
- "Too minimal" message and stat noise on the home — strip the
  narration, keep the orb and the chat input only.
- The orb "looks like an EARTH right now not meaningful enough for AI"
  — improve material and motion within bounds (no full plasma shader
  rebuild yet; that's task 016 territory).

## Requirements

### Top bar

- Left cluster: `⚡ WARD` logo lockup + active workspace dropdown
  (`brief ▼`) that lists workspaces and a `+ New workspace` action.
- Right cluster: a refresh icon (global soft refresh) and a settings
  icon (opens the Settings modal).
- Existing left/right drawer triggers either move into the palette or
  are removed from the top bar.

### Home view (orb-centric)

- The atmospheric orb dominates the center.
- Single control row at the bottom: speak button, text input
  (`Send a message…`), send button. Same component as today's
  `orb-dock` but restyled.
- Conversation transcript collapsed by default; renders only when there
  are turns. Auto-scrolls to latest, expandable on click.
- No daily-brief narration paragraph. No metric cards. No drawers
  visible by default.

### Settings as a glass modal

- Click the settings icon → glass modal overlay (dark, blurred backdrop),
  centered, max width ~720 px. Closes on backdrop click and Esc.
- Two tabs along the top: **Standard** | **Advanced**.
- The existing Settings *surface* (`activeView === "settings"`) is
  retired in favor of the modal; routing concerns and brain budgets
  still reachable inside the modal under Advanced.

#### Standard tab

- **Profile** card
  - Name (text, save on blur)
  - Voice (dropdown with ▶ test that synthesizes a sample phrase)
  - Speak replies (toggle, instant save)
  - Hidden in this task: timezone, persona tone, presence default,
    TTS rate/pitch. Components remain in code, conditionally rendered
    by a `showAdvancedProfile` flag for future use.
- **Theme** card
  - ◉ Dark · ◯ Light · ◯ System
  - Only Dark is wired for selection in this task; Light and System
    are visible but disabled with a subtle "coming soon" note.

#### Advanced tab

- **Agents** section grouped by role (no flat brain list):
  - Harness 1 — `claude-code-cli` (CLI · subscription · Coding)
  - Harness 2 — `codex-cli` (CLI · subscription · Coding)
  - Orchestrator — `local-openai-compatible` (local · Conversational)
  - Stub (test only) — `stub-worker` (simulated · Smoke test)
  - Each card shows: icon, role label, brain name, runtime / accounting,
    enabled toggle (instant save), and a `Configure` expander that
    reveals budgets, model, base URL, and (for Orchestrator) the probe
    + test reply controls currently on the Local brain panel.
  - Routing collapses to a "Show routing" link; opens the existing
    per-concern selector unchanged.
- **MCP** section: existing 009G connections panel, condensed to show
  only enabled servers + an "Add server" entry point. Full management
  remains accessible from the existing scope tabs inside the modal.
- **Memory** section: a single quick-link card "Open Memory" that
  opens the existing memory view via the palette. Memory is no longer
  a top-level surface in the main nav.

### Command palette (Cmd+K)

- Lightweight overlay, dark glass, single input + filtered list.
- Commands ship in this task:
  - "Go to Sessions"
  - "Go to Workspaces"
  - "Go to Memory"
  - "Go to Planning"
  - "Launch session…" (opens existing Sessions launch modal)
  - "Switch workspace to <slug>" (one entry per workspace)
  - "New workspace…" (opens existing new-workspace modal)
- Cmd+L is a direct shortcut to open the launch session modal.
- Esc closes the palette. Up/Down + Enter navigate the list.

### Hidden / parked surfaces

These remain in the codebase but are not rendered by default in this
task. Restoring them is a future task once their use case returns.

- Local brain status panel (Probe / Test reply) — folded into the
  Orchestrator agent card's Configure expander.
- Cost Today / Cost Forecast — kept; hidden until a non-subscription
  brain is configured.
- Quota Ledger — kept; hidden by default.
- Daily-brief narration on the home view — not rendered.
- Plan Mode entry from main nav — accessible from Workspaces detail
  and from the palette ("Go to Planning"); the original nav slot is
  removed.

### Live updates ("no-refresh" requirement)

- **Visibility-aware refresh**: when `document.visibilityState` flips to
  `visible`, refresh the active surface's primary list once (debounced).
- **Post-mutation soft refresh**: after every successful POST/PATCH/
  DELETE the client refetches the affected list. Audit and fill gaps
  for: workspaces, tasks, sessions, brains, MCP scopes.
- **Cross-surface bubble**: extend the existing per-session SSE handler
  so `session.state_changed` and `worker.exit` events also nudge the
  workspace list / overview counts to refresh. Today only the active
  session's detail object updates.
- **Optional gentle poll**: a 30-second visibility-gated poll for
  `/api/overview` so counts and brief data stay fresh without
  thrashing.

### Orb improvements (bounded; full shader rebuild is task 016)

- Replace the current "earth-like" feel with an abstract AI-orb feel.
  The geometry is already `IcosahedronGeometry`; tune material and
  add atmosphere.
- Material: shift colors away from blue+white "earth" palette toward a
  high-contrast plasma/AI palette (e.g. teal-magenta-violet). Increase
  emissive intensity and add additive blending.
- Add a rotating outer halo / atmosphere ring (translucent, slowly
  rotating, inverse to the orb).
- Add a subtle particle field around the orb to give depth.
- TTS-reactive: hook into `speechSynthesis` `start` / `end` /
  `boundary` events and propagate an intensity prop into `WardOrb`.
  While WARD is speaking, the orb's `emissiveIntensity` and scale
  modulate slightly with each phoneme boundary. Reset when speech
  ends.
- Keep the current pointer interaction (hover tilt, pulse on click).

### Typography

- Display font: Geist Mono or Space Grotesk, vendored locally — used
  for headings, numerics, the logo. Wide letter-spacing on labels
  (`0.12em`+).
- Body font: Inter or Geist Sans. Used for paragraphs and form input.
- Logo is `⚡ WARD` in monospace, all caps.
- Numbers in stat strips use tabular numerals.

### Dark theme tokens

- `--bg`: `#0a0d10` with a subtle radial gradient toward the orb
  (handled by `.orb-background`).
- `--ink`: `#e6e9ec`.
- `--muted`: `#7d8a92`.
- `--border`: `rgba(255, 255, 255, 0.08)`.
- `--accent`: bumped saturation green/teal for visibility on dark.
- `--surface-glass`: `rgba(15, 21, 24, 0.68)` + 18-24 px backdrop blur
  for modals and the palette.
- `--surface-card`: `rgba(255, 255, 255, 0.04)` with a 1 px border.
- The terminal dock keeps its existing dark style; the rest of the app
  conforms to the new tokens.

## Out of Scope

- Full custom plasma orb shader (task 016 or later).
- Light theme + System theme. Tokens scaffolded so they can be swapped
  later, but not selectable.
- Multi-step "agentic orb conductor" — the orb analyzing
  `add task X assigned to Claude` and executing the chain. Tracked as
  task 016. This task only ships nav escape hatch (already in 014) +
  one simple "launch session" intent that opens the modal pre-filled.
- Restoring the panels we hide (Cost, Quota, narration). They live in
  code but are not rendered.
- Comprehensive keyboard shortcut framework — only Cmd+K and Cmd+L are
  added in this task.
- Reskin of the Sessions terminal dock — already dark.
- Bringing back light-on-dark / contrast accessibility tuning across
  every legacy screen — out of scope for this pass; only the rendered
  surfaces are tuned.

## Proposed File Changes

- `apps/ui/src/main.tsx`
  - Replace the top bar with the new logo + workspace dropdown +
    refresh + settings layout.
  - Strip the home view to orb + chat dock + collapsible transcript;
    remove brief narration and stat strips.
  - Convert Settings from a `surface` view to a glass modal; reuse
    existing forms inside two tabs.
  - Group brain registry rows by role (Harness 1/2, Orchestrator, Stub)
    with new agent card markup; fold local brain probe + test reply
    into the Orchestrator card.
  - Add a Cmd+K command palette overlay with the listed commands.
    Bind Cmd+L to open the launch modal.
  - Add the live-update plumbing: visibility listener, post-mutation
    refresh audits, SSE-bubble to workspaces / overview, and the 30-s
    overview poll.
  - Drop direct rendering of the daily-brief narration; keep the
    `/api/overview` fetch for counts.

- `apps/ui/src/components/WardOrb.tsx`
  - Accept new props: `intensity?: number` (TTS-reactive), `palette?:
    "ai" | "earth"` (default `ai`).
  - Tune material colors toward plasma palette; add halo ring and
    particle field; modulate emissiveIntensity and scale by intensity.

- `apps/ui/src/styles.css`
  - Swap to dark token palette under a single body class
    (e.g. `body.theme-dark`).
  - Add modal + palette + tab + agent-card + atmospheric-background
    styles.
  - Add the new typography stack and font-face declarations
    (vendored).
  - Conditionally render-and-style the new card layouts; retire the
    settings-grid / panel styles for the surfaces being moved into
    modals.

- `apps/ui/index.html`
  - Add font preload links and `theme-dark` class on `body` until a
    theme switcher exists (task 015 ships dark only).

- `docs/task/015-…` and `TASKS.md`
  - Slice tracking and Implementation Notes after the work lands.

No runtime, schema, or CLI changes. APIs already in place.

## Code Context

- Three.js orb component: `apps/ui/src/components/WardOrb.tsx`. Already
  uses `IcosahedronGeometry`; needs material + atmosphere + reactive
  prop changes.
- Top bar: `apps/ui/src/main.tsx` `<header className="orb-topbar">`
  near line 2160; current command-menu state in `commandMenuOpen`,
  `commandTabs`.
- Settings view: `apps/ui/src/main.tsx` `activeView === "settings"`
  block near line 1995. Forms reused: `saveProfile`, `toggleBrain`,
  `saveBrainBudget`, `saveBrainRoute`, `runLocalBrainProbe`,
  `runLocalBrainTest`.
- Brain registry row UI: same file near line 2476 (`brain-dashboard`).
- Local brain panel: same file near line 2466 (`local-brain-panel`).
- Theme tokens: `apps/ui/src/styles.css` lines 1–35.
- TTS: `apps/ui/src/main.tsx` `speak()` near line 850 — tap into
  `speechSynthesis` events here for orb intensity.
- Live update gaps to audit:
  - `createWorkspace` already calls `refresh()`; verify all mutations
    follow this pattern.
  - SSE handler at line 1262 only updates `sessionDetail`; should also
    nudge `refreshSessionSurface` and `refresh()` (overview counts) on
    `session.state_changed` reaching `done`/`failed`/`blocked`.

## Implementation Steps

1. Add the dark theme tokens and font-face declarations. Apply
   `theme-dark` to the body. Snapshot the home view to confirm baseline.
2. Replace the top bar with the new logo + workspace dropdown + refresh
   + settings icons. Wire the existing data; the dropdown reuses the
   existing `setSelectedSlug` and the new-workspace modal.
3. Strip the home view: remove narration, stat strips, command-menu
   tab list. Keep the orb and the chat dock.
4. Improve `WardOrb`: add the `intensity` prop, atmosphere ring,
   particle field, plasma palette. Wire the TTS event hook so the orb
   pulses while WARD is speaking.
5. Build the Settings glass modal with Standard / Advanced tabs.
   Reuse existing form components; reorganize agents into role-based
   cards; fold the local brain panel into the Orchestrator card.
6. Build the Cmd+K command palette overlay; register Cmd+K and Cmd+L
   keyboard listeners.
7. Implement the live-update plumbing: visibility listener,
   post-mutation refresh audit, SSE bubble, and 30-s overview poll.
8. Hide the parked panels (Cost, Quota, narration, Plan-Mode-from-nav)
   without deleting their components.
9. Manual UI smoke: Cmd+K palette, Cmd+L launches a session, modal
   tabs work, agents enable/disable in real time, TTS-reactive orb
   responds to a Speak click, mutations propagate without F5.
10. Update Implementation Notes; move 015 to Testing in TASKS.md.

## Acceptance Criteria

1. Home view is dominated by the orb, with a single chat-input row
   below and no narration / stats / drawer chrome.
2. Top bar shows logo + workspace dropdown on the left, refresh +
   settings icons on the right.
3. Settings opens as a glass modal with Standard / Advanced tabs.
   Backdrop click and Esc both close it.
4. Standard tab shows Profile (name + voice + speak-replies toggle)
   and Theme (Dark active; Light and System disabled with a hint).
5. Advanced tab groups agents by role (Harness 1, Harness 2,
   Orchestrator, Stub). Each card has an enabled toggle and a Configure
   expander; the Orchestrator card includes the probe + test reply
   controls previously on the Local brain panel.
6. Cmd+K opens the command palette; the listed commands all dispatch
   correctly. Cmd+L opens the launch session modal.
7. Mutations (create workspace, add task, launch session, enable brain,
   change route) update the visible UI within 1 second without manual
   refresh.
8. Switching focus away from and back to the tab refreshes the active
   surface's data without a flash of stale state.
9. While `speechSynthesis` is speaking, the orb visibly modulates and
   stops modulating cleanly when speech ends.
10. The orb no longer reads as Earth — atmospheric ring, plasma palette,
    and emissive material make it abstract.
11. `bun run typecheck`, `bun run build`, `git diff --check`, and
    dependency-cruiser pass.

## Verification

- `bun run typecheck`
- `bun run build`
- `git diff --check`
- Manual UI smoke against the running runtime:
  - Open `http://127.0.0.1:47730/` and confirm dark home + new top bar.
  - Click the workspace dropdown; switch workspaces, create one.
  - Open Settings; toggle TTS, change voice, verify the orb pulses on
    a Speak click. Switch to Advanced; toggle an agent and confirm the
    state persists.
  - Press Cmd+K; navigate to Sessions, Memory, Planning. Press Cmd+L;
    confirm the launch modal opens.
  - Add a task, launch a session, watch the workspace and session
    counts update without F5.
  - Stop and restart the daemon; reload; confirm theme persists, no
    refresh-required state.

## Implementation Notes

_To be filled in by the implementation stage._
