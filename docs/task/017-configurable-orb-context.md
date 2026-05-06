# Task 017: Richer + Configurable Orb Context

- Status: `testing`
- Type: `feature`
- Version Impact: `minor`
- Priority: `medium-high`
- Depends on: 014, 015, 008C
- Recommended Tier: `balanced`

## Overview

Make the WARD orb chat give specific, situational replies instead of
generic ones, and make the context it sends to the local brain
**configurable from Settings** so power users can tune both the
persona and which categories of state are injected.

The orb chat (task 014) currently sends a tightened 3-line system
prompt to gemma4:e2b — only counts (`workspaces=N, open_tasks=N,
blockers=N, sessions=N`). Replies are accurate but flat: the orb
knows you have two open tasks but cannot say which ones, cannot
mention the active workspace by name, and cannot reference the
session that just finished. The user's framing during planning:

> "this becomes too generic" … "I think you can add that as a
> parameters or system prompts in the settings so this becomes
> configurable :D depending on user"

This task expands the default context so it stops being generic AND
exposes a Settings card (modeled on the BoltAI System Instruction
pattern from the references) where the user can override the system
prompt, toggle which state categories are injected, and budget the
total token cost so replies stay fast.

## Requirements

### Defaults (out of the box, no config touched)

The composed system prompt has two parts:

1. **Header** — persona / behavior guidance. Default mirrors task 014:
   > `You are WARD, {name}'s local peer developer. Tone: {tone}. Reply
   > in 1-3 short sentences unless asked for more.`
2. **State context** — appended automatically. By default includes:
   - **Active workspace**: name + repo path.
   - **Top 3 open tasks**: short id, title, priority.
   - **Latest 3 sessions**: brain id, lifecycle state, summary fragment
     (truncated to ~80 chars).
   - **Today's local date**: e.g. `Today: 2026-05-06 (Wed)`.
   - **Profile**: display name + persona tone (already in header but
     repeated here for the model's situational awareness).
   - Closing line: `Data is read-only context. For real code edits,
     tell the user to launch a Sessions run.`

The greedy fill order when the budget is tight:
**workspace → tasks → sessions → date → profile**.

### Configurable from Settings

A new "Orb context" card on the Standard tab of the Settings modal
(per task 015). If 015 has not landed yet, the card lives on the
existing Settings surface in the Profile section.

Card layout:

```
ORB CONTEXT
  System instruction
  ┌─────────────────────────────────────────────────────┐
  │ You are WARD, {name}'s local peer developer. Tone…  │
  │                                                     │
  │ [6-row monospace textarea]                          │
  └─────────────────────────────────────────────────────┘
  Override how the orb introduces itself. Leave blank to
  use the default. State context is appended automatically.
  [Save]   [Reset to default]   [▶ Test reply]

  Include in context
  ☑ Workspace and repo path
  ☑ Top 3 open tasks
  ☑ Recent sessions (last 3)
  ☐ Wiki snippets (experimental)

  Token budget
  [── slider 200 ─────●── 1500 ──]    ~ 612 / 800 tokens
  Smaller budget = faster replies. Default keeps prefill
  under 250 ms on gemma4:e2b.
```

### Persistence

Use the existing preference system (`packages/memory/src/repositories.ts`
`setPreference` / `listPreferences`). Scope = `global`. Keys:

| Key | Type | Default |
|---|---|---|
| `orb.system_prompt_override` | string | `""` (empty = use default) |
| `orb.context.include_workspaces` | bool | `true` |
| `orb.context.include_tasks` | bool | `true` |
| `orb.context.include_sessions` | bool | `true` |
| `orb.context.include_wiki` | bool | `false` |
| `orb.context.token_budget` | int | `800` |

Existing preference API (`GET /api/preferences`,
`PATCH /api/preferences/{scope}/{key}`) is sufficient — no new
endpoints or schema changes.

### Runtime composition

`composeOrbSystemPrompt()` in `apps/runtime/src/index.ts` becomes:

```
function composeOrbSystemPrompt(): string {
  const overrides = readOrbContextOverrides();   // pulls preferences
  const header = overrides.systemPrompt || defaultHeader();
  const blocks: string[] = [header];
  if (overrides.includeWorkspaces) blocks.push(buildWorkspaceBlock());
  if (overrides.includeTasks)      blocks.push(buildTaskBlock(3));
  if (overrides.includeSessions)   blocks.push(buildSessionBlock(3));
  if (overrides.includeWiki)       blocks.push(buildWikiBlock());
  blocks.push(buildDateBlock());
  blocks.push(buildClosingNote());
  return clampToBudget(blocks, overrides.tokenBudget);
}
```

`clampToBudget` is greedy: it accepts blocks in order until adding the
next one would exceed the budget; it then truncates the next-most-
important block to fit (e.g. drop the third session) before stopping.

Token estimation: `Math.ceil(text.length / 4)`. No real tokenizer
dependency — the approximation is good enough for budgeting.

### UI helper: live token count

The Settings textarea shows `~ N / BUDGET tokens` updating on every
keystroke. The N estimate is the same `Math.ceil(text.length / 4)`
heuristic on the textarea contents PLUS a synthesized state-context
block built from current preferences toggles. So the user sees the
total cost of what they're about to send, not just the override.

### Wiki snippets toggle (experimental)

When `include_wiki` is true, append:
- The first 200 chars of `decisions.md` from the active workspace's
  wiki, if it exists.
- The most recent wiki commit message + author + scope.

No semantic search, no embeddings. Just the latest decisions head.
Marked "experimental" in the UI because content varies wildly by
workspace.

### Reset and test

- **Reset to default** clears `orb.system_prompt_override` and resets
  the four toggles + budget to their defaults via single PATCHes.
- **Test reply** runs an immediate non-streaming chat with the current
  composed prompt + a fixed test message ("Reply with one short
  greeting") and shows the result inline. Reuses
  `POST /api/brains/{id}/test-reply` from task 014 with a small
  extension: accept `system_prompt` in the body so the user can preview
  unsaved changes without committing them.

## Out of Scope

- Mention-aware dynamic injection. Typing "task X" or a workspace name
  in the orb does NOT trigger a per-turn lookup. Tracked under
  "Future enhancements" below.
- Tool calling / function calling on the local brain. That is task 016.
- A real tokenizer (tiktoken-equivalent). The char/4 heuristic is good
  enough; ship it as-is. Re-evaluate if users complain about budget
  drift.
- RAG over the wiki via embeddings. The wiki snippets toggle in v1
  injects the latest decisions head — no semantic retrieval.
- Per-conversation memory beyond the existing eight-turn transcript
  history (already passed by the UI in task 014).
- Multi-persona presets (`@architect`, `@reviewer`). One override per
  user is enough for v1; presets can come later if a user asks.
- Settings model picker (`gemma4:e2b` vs `gemma4:e4b` vs others).
  Stays in `brains.yaml` until a future task surfaces it.

## Future enhancements (logged here, not in this task)

- **Mention-aware injection**: detect a workspace slug or task title
  in the user's message and inject that entity's full details for
  that turn only. ~50 line change inside the runtime once we have
  this card to build on.
- **Per-conversation pinned context**: user pins a workspace or task
  in the orb so it's always included for the duration of that
  conversation.
- **Persona presets** stored in preferences, switchable from the
  textarea via slash commands or a dropdown above the textarea.

## Proposed File Changes

- `apps/runtime/src/index.ts`
  - Replace `composeOrbSystemPrompt()` with the configurable version.
    Add helpers: `readOrbContextOverrides()`, `buildWorkspaceBlock()`,
    `buildTaskBlock(n)`, `buildSessionBlock(n)`, `buildWikiBlock()`,
    `buildDateBlock()`, `clampToBudget(blocks, budget)`.
  - Extend `handleBrainTestReply()` to accept an optional
    `system_prompt` field on the request body so the Settings test
    reply can preview the user's unsaved override.
- `apps/ui/src/main.tsx`
  - Add the "Orb context" card to the Settings modal Standard tab
    (or to the existing Settings surface if 015 has not landed).
    Wire textarea, toggles, and budget slider to the preferences API.
  - Live token count using the same char/4 heuristic the runtime
    uses for symmetry.
  - Test reply button posts `{ message: "Reply with one short
    greeting", system_prompt: <textarea> }` to
    `/api/brains/local-openai-compatible/test-reply`.
- `apps/ui/src/styles.css`
  - Styling for the new card (textarea, slider, toggle row).
- `docs/task/017-…` and `TASKS.md`
  - Slice tracking + Implementation Notes after the work lands.

No schema changes. No new endpoints (uses existing
`/api/preferences` + extended `/api/brains/{id}/test-reply`).

## Code Context

- Current orb system prompt: `apps/runtime/src/index.ts`
  `composeOrbSystemPrompt()` near line 559 in the post-014 layout.
  Today it returns three lines built from `getProfile()`,
  `listWorkspaces()`, `listTasks()`, `listHarnessSessions()`.
- Preferences API:
  - `packages/memory/src/repositories.ts`
    `listPreferences()`, `setPreference(scope, key, value, workspaceId?)`.
  - `apps/runtime/src/index.ts` exposes `GET /api/preferences` and
    `PATCH /api/preferences/{scope}/{key}` (search for `parts[0] ===
    "preferences"`).
- Test reply endpoint: `handleBrainTestReply()` in the runtime, near
  the other brain endpoints. Currently builds messages as
  `[{ role: "user", content: message }]` — needs an optional system
  prompt prepend.
- Settings modal location: from task 015 spec, lives in
  `apps/ui/src/main.tsx` Standard tab. If 015 has not shipped, add to
  the existing Settings panel near the profile form
  (`saveProfile` handler around line 1310).

## Implementation Steps

1. Add the preference helpers to the runtime: read each `orb.*` key
   with sensible defaults, expose a typed
   `readOrbContextOverrides()` shape.
2. Refactor `composeOrbSystemPrompt()` into the block-builder
   approach with `clampToBudget`. Verify token estimates are sane
   against measured prefill.
3. Extend `handleBrainTestReply()` to accept an optional
   `system_prompt`.
4. Add the "Orb context" card to the Settings modal (or current
   Settings surface). Wire each control to a `PATCH
   /api/preferences/global/{key}` call. Instant save on toggles +
   slider; explicit Save on the textarea.
5. Implement the live token count in the textarea using the same
   char/4 heuristic the runtime uses.
6. Wire the Test reply button to post the unsaved system prompt as
   well as the test message.
7. Add a "Reset to default" affordance that clears all six keys.
8. Manual UI smoke: defaults produce specific replies; override
   changes persona; toggles change context; budget reduces prefill
   time perceptibly.
9. Update Implementation Notes; move 017 to Testing in TASKS.md.

## Acceptance Criteria

1. With default settings (no override, all toggles on, budget 800),
   asking the orb "what should I work on?" returns a reply that
   names the active workspace AND at least one specific open task by
   title.
2. Editing the system instruction textarea, saving, and sending a
   chat produces a reply written in the new persona.
3. Toggling "Recent sessions" off makes the orb respond "I don't
   have session details right now" or similar — proves the toggle
   actually changes what the model sees.
4. The Settings token-count display updates as the user types in
   the textarea.
5. Lowering the token budget below the natural size of the context
   block visibly trims session entries first, task entries next, and
   keeps workspace + date.
6. Test reply uses the unsaved textarea content as the system prompt
   for that one call without persisting it.
7. Reset to default clears all six preference keys (verified by
   `GET /api/preferences`).
8. The Settings card persists across page reload and across daemon
   restart (preferences are SQLite-backed, so this should be free —
   verify it actually is).
9. `bun run typecheck`, `bun run build`, `git diff --check` and the
   dependency-cruise check all pass.

## Verification

- `bun run typecheck`
- `bun run build`
- `git diff --check`
- Direct curl against `GET /api/preferences` after toggling each
  control to confirm persistence.
- Manual UI smoke:
  - Open Settings → Orb context. Confirm defaults and live token
    counter.
  - Change the system prompt to "You are a terse assistant. Reply in
    haiku." Save. Send "what should I work on?" — verify the reply
    is structured as haiku.
  - Toggle off "Recent sessions". Send a chat that depends on
    sessions ("did anything finish?"). Verify orb cannot recall.
  - Drag budget to 250. Send a chat. Verify prefill is faster (you
    can sample first-token latency in the network tab).
  - Test reply button returns a sentence within ~1 s.
  - Reload the page. Settings persist.

## Implementation Notes

### What Changed

- `composeOrbSystemPrompt()` is now async and assembles the prompt
  from a list of blocks (workspace, top tasks, recent sessions,
  optional wiki snippet, date, profile, closing note) gated by the
  user's `orb.*` preferences. The persona header is the user's
  override when present, otherwise the previous default.
- `clampToBudget()` greedy-fills blocks in priority order and
  truncates the next block if it overflows the configured token
  budget. Token estimate uses `Math.ceil(text.length / 4)`.
- `handleBrainTestReply()` now accepts an optional `system_prompt`
  string in the request body; when present, the runtime composes the
  full orb prompt with that string as the header override and uses
  it as the `system` message for the test call.
- A new "Orb context" card lives at the bottom of the Settings →
  Standard tab. Textarea (system override) saves explicitly; toggles
  and the budget slider persist instantly via
  `PATCH /api/preferences/global/{key}`. Live token-cost estimate
  combines the textarea length with a coarse fixed cost per enabled
  category, mirroring the runtime char/4 heuristic.
- Reset to default issues a parallel batch of six PATCHes, one per
  preference key.

### Files Changed

- `apps/runtime/src/index.ts` — replaced `composeOrbSystemPrompt`,
  added preference reader and block builders, made
  `buildChatMessages` async, threaded `system_prompt` through the
  test-reply handler.
- `apps/ui/src/main.tsx` — added orb-context preference types,
  defaults, state, fetcher, save/reset/test handlers, sync effect for
  the textarea draft, and the new Settings card.
- `apps/ui/src/styles.css` — styling for the orb-context card
  (textarea, action row with right-aligned token counter, section
  divider, slider row).

### Deviations From Plan

- The Profile block is appended in addition to the date block; the
  doc lists profile as part of the state context but says it's
  "repeated here for the model's situational awareness," so it sits
  beside the date in the trailing trio (date, profile, closing note).
- Block separator is a blank line (`\n\n`) instead of a single
  newline, so the local model sees clearly delimited sections. The
  budget heuristic still treats each block as a single contiguous
  cost.
- The wiki block uses the most-recently-opened workspace (first row
  from `listWorkspaces()`); WARD has no explicit "active" workspace
  signal yet.
- "Reset to default" intentionally PATCHes every key (instead of
  deleting them) so the resulting state is unambiguous in
  `GET /api/preferences`.

### Verification Run

- `bun run typecheck` — PASS
- `bun run build` — PASS (vite build, tsc, depcruise, layer fixture)
- `git diff --check` — PASS (no whitespace errors)
- Manual UI smoke — SKIPPED (requires running daemon + Ollama; will
  be exercised in the test stage).
