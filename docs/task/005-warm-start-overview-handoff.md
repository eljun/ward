# Task 005: Warm-Start Pipeline, Overview, Handoff, and TTS

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 003, 004

## Summary

Implement the precompute pipeline per `001/warm-start.md`, build the Overview
screen (daily brief, active workspaces, running sessions, handoffs), the
end-of-session handoff writer, and browser-native TTS for greetings and
short notifications.

## In Scope

### Warm-start pipeline

- Cache layer in `packages/memory` with LRU + disk snapshot.
- Invalidation bus that subscribes to 001/event-taxonomy events and marks
  cache keys stale per the mapping in `001/warm-start.md`.
- Debounced refresh scheduler (1 s default, 10 s for low-priority).
- Cold-start prewarm: `daily_brief`, last-opened workspace summary,
  active-blockers for all active workspaces.
- `warmcache.refreshed` and `warmcache.missed` events.

### Daily Brief

- Structured layer (deterministic JSON from SQLite + cache):
  - yesterday's session completions (success / fail counts, durations)
  - open blockers per workspace
  - suggested next actions (from prior Post-session outputs)
  - upcoming scheduled runs
- Narrated layer (Orchestrator Brain `recap_and_brief` mode):
  - short paragraph introducing the day
  - "Hey <honorific> <name>" if profile has honorific
  - optional `speak: true` for TTS
- API: `GET /api/brief/today`
- Regenerates prose when structured content changes meaningfully.
- Per local-tz day; cache rolls at midnight.

### Overview screen (UI)

- Greeting card (name + honorific + brief narration; "speak" button)
- Active workspaces list with status indicators
- Running / paused sessions
- Recent handoffs (last 5)
- Blockers list
- "What should I resume first?" action button that opens a conversational
  prompt pre-filled

### Handoff writer

- Triggered by `session.completed` or `session.failed` via Orchestrator
  Post-session mode.
- Produces:
  - 1–3 sentence outcome summary
  - key changes list
  - artifacts (PR URL, branch, files changed)
  - blockers
  - handoff card (1–2 sentences, next step)
- Writes:
  - `memory/workspaces/<slug>/wiki/sessions.md` (appended entry)
  - `memory/workspaces/<slug>/wiki/decisions.md` if the session touched
    architecture (Brain decides)
  - `outcome_record` row in SQLite (new table in this task's migration)
- Surfaces in UI as a toast (if present) or notification (if away).

### Browser TTS

- Uses `window.speechSynthesis` — no backend dep.
- Preference toggles per profile:
  - `tts_enabled` (master)
  - speak daily brief
  - speak short notifications (completion, blocker)
- Voice / rate / pitch selection from profile.
- Frontend utility in `apps/ui` reads Brain outputs that carry `speak: true`.

### CLI

- `ward brief [--today|--yesterday]`
- `ward handoff show <session-id>`
- `ward warm` — force prewarm refresh
- `ward warm stats` — hit rate and key freshness

## Out of Scope

- Real Brain adapters (uses simulated brain; real brains land in 008)
- Plan Mode (006)
- Alerts via Slack / Telegram (010)
- STT (not in MVP)

## Acceptance Criteria

1. On daemon start, `daily_brief` cache key is warm within 3 s.
2. Opening UI Overview renders structured brief instantly (< 100 ms after
   auth); narration streams in within 500 ms of request.
3. `ward brief` from CLI returns the same content.
4. Completing a simulated session triggers handoff writer; wiki
   `sessions.md` gets a new entry with a git commit prefixed `[llm]`.
5. Cache miss rate under steady-state load stays under 1 % (measured via
   `warmcache.missed` event count / total reads).
6. TTS toggle speaks the greeting and a test notification.
7. Midnight local-tz rollover triggers brief regeneration.

## Deliverables

- Warm cache implementation (in-memory LRU + disk snapshot + invalidation
  bus)
- Migration `0005_outcomes.sql` with `outcome_record` table
- Brief generator (structured + narrated)
- Handoff writer
- Overview screen + greeting component + TTS util
- CLI subcommands

## Risks

- Narration latency with local LLMs may exceed target; pre-generate
  narration asynchronously and fall back to structured-only if not ready.
- Cache invalidation bugs are subtle; include fuzz tests from
  `001/warm-start.md`.
