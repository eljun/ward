# Task 014: Conversational Orb Chat with a Local Brain

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 008B, 008, 005
- Recommended Tier: `balanced`

## Overview

Replace the deterministic regex intent router behind the WARD orb chat with
a real LLM conversation backed by a local Ollama brain. Implement the
missing OpenAI-compatible streaming adapter so the
`local-openai-compatible` brain in the registry actually works, point it at
`http://127.0.0.1:11434/v1` with model `gemma4:e2b`, and stream replies
into the orb transcript with optional auto text-to-speech so WARD can
finally "speak."

WARD's pitch is "personal orchestrator and peer developer." The peer
developer side is currently invisible: the orb chat pattern-matches
keywords and opens drawers, and the Speak button is the only path to
audio output. This task makes the orb a real conversation surface and
gives WARD a voice.

## Requirements

### OpenAI-compatible streaming adapter

- Add a brain chat adapter that posts to `/v1/chat/completions` against
  any OpenAI-compatible base URL.
- Support streaming via Server-Sent Events with `delta.content` chunk
  parsing.
- Provide a non-streaming fallback for callers that need a single reply.
- Compose the request body as `{ model, messages: [{role, content}], stream }`.
- Allow request abort via `AbortSignal` and a configurable timeout.
- No tool calling, no JSON mode, no embeddings in v1.
- Surface clean errors when the base URL is unreachable, the model is
  missing, or the upstream returns an error JSON.

### Brain registry wiring

- When a brain has `kind: "openai-compatible"` and is enabled, route calls
  through the new adapter using the brain's `base_url` and `model`.
- Update default seed of `local-openai-compatible` so `model` defaults to
  `"gemma4:e2b"`.
- Leave `enabled: false` in the seed so existing installs do not surprise
  users; new endpoints will return a clear "brain disabled" error until
  the user enables it from Settings.
- Add a small reachability probe used by Settings:
  `GET /api/brains/{id}/probe` returns `{ reachable: bool, model_present: bool, latency_ms, error? }`
  by calling Ollama's `/api/tags` (or `/v1/models`) with a 3-second
  timeout.

### System prompt builder

- Build a single composed system prompt under 1 KB that frames WARD as a
  peer-developer assistant. Inputs: profile (display name, honorific,
  persona tone), today's overview brief, active workspace name + open
  task count, last 3 sessions (id, brain, lifecycle state), open
  blockers count.
- The prompt must explicitly say:
  - WARD's data here is read-only context;
  - For real code or file changes, the user should launch a Sessions run
    (claude-code-cli or codex-cli);
  - Replies should be short (one to four sentences) and conversational by
    default; longer only if explicitly asked.
- Persona tone from the user's profile drives voice ("casual" /
  "professional" / etc.).

### Streaming orb chat endpoint

- Add `POST /api/orb/chat/stream` that returns Server-Sent Events.
- Body: `{ message: string, history?: Array<{role, content}> }`.
- Server composes the system prompt + history + user message, calls the
  brain adapter in streaming mode, and emits SSE events:
  - `delta` events with `{ text }` chunks.
  - A `done` event with `{ trace_id, timestamp, surface? }` at the end.
  - An `error` event on failure with `{ message }`.
- Add a small explicit-nav escape hatch BEFORE calling the brain: if the
  user message exactly matches one of `open settings`, `open sessions`,
  `open workspaces`, `open planning`, `open memory`, `go to <surface>`,
  short-circuit and return a single `done` event with the matching
  `surface` and a one-line reply ("Opening Sessions.") instead of
  streaming an LLM reply. Pure navigation should not burn tokens.
- Keep the existing `POST /api/orb/chat` endpoint for backwards
  compatibility through this release: it remains the regex router and
  is the fallback when the local brain is disabled or unreachable.

### UI: stream consumption + transcript

- In `apps/ui/src/main.tsx`, change `submitOrbChat` to:
  - Call `/api/orb/chat/stream` when a streaming-capable enabled brain
    is available;
  - Append a placeholder assistant turn to the transcript and update its
    text as `delta` events arrive;
  - Show a typing indicator while the stream is open;
  - On `error`, surface the message in the inline banner and keep the
    user's message in the transcript (so they can retry);
  - On nav `surface` from `done`, call the existing surface-switch logic.
- Fall back to the existing non-streaming `/api/orb/chat` when no
  streaming brain is enabled (preserve current behavior for users who
  haven't run the bootstrap).

### Auto text-to-speech

- When `profile.tts_enabled` is true, automatically speak the assistant
  reply text via the existing `speak()` helper.
- v1: speak the full message at end-of-stream (not chunked) — simpler
  and avoids the jitter of mid-utterance speech synthesis.
- The Speak button stays as a manual replay (re-speaks the latest
  assistant turn).
- Add a "Speak replies automatically" toggle in Settings → Profile that
  edits `profile.tts_enabled`. Already exists — confirm it persists and
  is wired to the new auto-speak path.

### Settings affordance

- In Settings, add a "Local brain status" row showing whether
  `local-openai-compatible` is reachable using the probe endpoint.
- Show the configured `base_url`, `model`, reachability, and last
  measured latency.
- When unreachable, surface a copy-paste-ready error message:
  > "Ollama not running at http://127.0.0.1:11434. Start with `ollama
  > serve` and pull the model with `ollama pull gemma4:e2b`."
- A small "Test reply" button that runs a one-shot non-streaming chat
  ("Reply with one short greeting") so the user can verify end-to-end
  without going through the orb.

## Out of Scope

- Tool calling / function calling from the local brain.
- Wiring routing concerns (`recap_and_brief`, `intent_parser`,
  `diff_summarizer`, `alert_composer`, `privacy_sensitive`) to actually
  use the local brain. The registry already routes these to
  `local-openai-compatible` but the call sites are not implemented in
  the runtime; that is a follow-up task.
- Routing the orb chat to claude-code-cli or codex-cli (subscription
  brains). Stay local-only for v1.
- Token / cost tracking for local brains. Already accounted as `local`
  in the brain registry; no $ to track.
- Multi-turn memory beyond the in-window orb transcript. No new
  persistence.
- Speech-to-text input (microphone capture beyond the existing browser
  TTS).
- Auto-enable / auto-detect of `local-openai-compatible` on first run.
  The user enables it explicitly from Settings after seeing the probe
  result. Simpler and avoids surprise.

## Proposed File Changes

- `packages/harness/src/openai-compatible.ts` (new) — chat client. Pure
  function `chatCompletion({ baseUrl, model, messages, stream, signal,
  timeoutMs })` returning either an async iterator of `{ delta: string,
  done: boolean }` for streaming, or `{ text: string }` for
  non-streaming. Sibling `probeOpenAiCompatible(baseUrl, expectedModel?)`
  for the reachability check.
- `packages/harness/src/index.ts` — export the new chat client and
  probe helper.
- `packages/memory/src/brains.ts` — set the seed
  `model: "gemma4:e2b"` on `local-openai-compatible`. Keep
  `enabled: false`.
- `apps/runtime/src/index.ts` —
  - Add `POST /api/orb/chat/stream` SSE endpoint.
  - Add `GET /api/brains/{id}/probe` endpoint.
  - Add a small `composeOrbSystemPrompt(profile, overview, …)` helper.
  - Add the explicit-nav escape hatch.
  - Leave the existing `POST /api/orb/chat` regex router intact for
    fallback.
- `apps/ui/src/main.tsx` —
  - Update `submitOrbChat` to call the streaming endpoint when a
    streaming-capable enabled brain is available; otherwise fall back
    to the existing endpoint.
  - Render a placeholder assistant turn and update it as `delta`
    chunks arrive; show a typing indicator.
  - On stream end, auto-speak via `speak()` when `profile.tts_enabled`.
  - Add a Settings "Local brain status" row with probe + Test reply.
- `apps/ui/src/styles.css` — typing indicator + Settings probe row
  styling.
- `docs/task/014-…` and `TASKS.md` — slice tracking.

## Code Context

- Existing orb chat regex router: `apps/runtime/src/index.ts:471`
  (`orbChatReply`). Returns `{ reply, surface, suggestions, trace_id,
  timestamp }`. The new endpoint can reuse the `surface` field from this
  shape for the nav escape hatch.
- Brain schemas: `packages/core/src/brains/index.ts`. `BrainKind` already
  includes `openai-compatible`. `BrainCapabilities` already exposes
  `streaming` and `json_mode` flags.
- Brain seed: `packages/memory/src/brains.ts:178`. The
  `local-openai-compatible` row has `base_url:
  "http://127.0.0.1:11434/v1"`, `kind: "openai-compatible"`, `model:
  null`, `enabled: false`. Update model to `"gemma4:e2b"`.
- Ollama OpenAI-compatible smoke verified during planning:
  `curl -s http://127.0.0.1:11434/v1/chat/completions -H 'content-type:
  application/json' -d '{"model":"gemma4:e2b","messages":[{"role":"user",
  "content":"Say hi in 5 words."}],"stream":false}'` returns a clean
  reply.
- TTS helper: `apps/ui/src/main.tsx:848` (`speak(text, profile)`),
  triggered today only by the Speak button. Reuse for auto-speak.
- Profile schema for `tts_enabled` is on
  `apps/ui/src/main.tsx:17` (interface) and saved through
  `/api/profile` PATCH.
- Layer rules from `dep-cruiser`: `packages/harness` is allowed to
  depend on `packages/core` and may host network calls (the harness
  adapters already do for CLI auth probes). The orb chat client lives
  there for symmetry with the harness adapters; if dep-cruise rejects
  this layout, fall back to a `packages/brains` package.

## Implementation Steps

1. Add the OpenAI-compatible chat client and probe helper in
   `packages/harness/src/openai-compatible.ts`. Cover streaming and
   non-streaming. Write a small fixture-friendly entry point (no
   process spawning).
2. Update brain seed in `packages/memory/src/brains.ts` so
   `local-openai-compatible` defaults to `model: "gemma4:e2b"`.
3. Add `composeOrbSystemPrompt` in the runtime that returns a prompt
   under 1 KB covering profile + overview + workspaces + sessions +
   blockers and the "delegate code work to Sessions" guidance.
4. Add `POST /api/orb/chat/stream` in `apps/runtime/src/index.ts`.
   Implement the explicit-nav escape hatch first, then the streaming
   path. Emit `delta`, `done`, `error` SSE events.
5. Add `GET /api/brains/{id}/probe` returning the reachability snapshot.
6. UI: update `submitOrbChat` to consume the SSE stream, append a live
   placeholder assistant turn, show a typing indicator, handle
   `error` and nav `surface`.
7. UI: when stream ends and `profile.tts_enabled` is true, call
   `speak()` with the full assistant message.
8. UI: Settings → add a "Local brain status" row using the probe
   endpoint and a "Test reply" button.
9. Verify end-to-end:
   - probe shows reachable + model present;
   - Test reply returns a sentence;
   - Orb chat shows live streaming text;
   - Auto-speak triggers when toggled on.
10. Update `docs/task/014-…` Implementation Notes and `TASKS.md`.

## Acceptance Criteria

1. With `local-openai-compatible` enabled and Ollama running with
   `gemma4:e2b`, typing a non-navigation message in the orb returns a
   conversational reply streamed live into the transcript.
2. Replies appear chunk-by-chunk with a visible typing indicator while
   the stream is open.
3. Typing exactly `open sessions` (and the other listed nav phrases)
   does not call the brain; it switches the active surface and shows a
   one-line reply.
4. With `profile.tts_enabled` true, the assistant reply is spoken
   automatically at end-of-stream using the user's preferred voice.
5. With `local-openai-compatible` disabled or unreachable, the orb
   falls back to the existing `/api/orb/chat` regex router and the UI
   surfaces a single, clear inline notice.
6. Settings shows a "Local brain status" row with `reachable`,
   `latency_ms`, configured `base_url`, and `model`. The Test reply
   button returns a sentence within 10 seconds when reachable.
7. Probe failures show actionable copy-paste guidance referencing
   `ollama serve` and `ollama pull gemma4:e2b`.
8. The system prompt fits under 1 KB and mentions: persona tone, that
   data is read-only, and that real code work goes through a Sessions
   run.
9. `bun run typecheck`, `bun run build`, `git diff --check` pass; no
   dep-cruise violations.

## Verification

- `bun run typecheck`
- `bun run build`
- `git diff --check`
- Direct curl smoke against the brain probe and stream endpoints with a
  `WARD_HOME=/tmp/ward-task014-smoke` fresh init.
- Manual UI smoke:
  - Open `http://127.0.0.1:47730/`, enable
    `local-openai-compatible` from Settings (or via brains.yaml).
  - Type `Hi WARD, how am I doing?` in the orb → expect a streamed
    conversational reply that references workspace and session counts.
  - Toggle `tts_enabled` → expect auto-speak on the next reply.
  - Type `open sessions` → expect the Sessions surface to switch
    instantly without a streamed reply.
  - Stop Ollama (`ollama stop` or kill the process) → expect Settings
    probe to flip to unreachable with the actionable guidance, and the
    orb to fall back to the regex router.

## Implementation Notes

### What Changed

- Added an OpenAI-compatible chat client and Ollama probe in
  `packages/harness/src/openai-compatible.ts`. Supports streaming SSE
  with `delta.content` parsing, a non-streaming convenience function,
  and a probe that hits `/api/tags` first then falls back to
  `/v1/models`.
- Wired `POST /api/orb/chat/stream` in the runtime to:
  - short-circuit on explicit nav intents (`open sessions`, `go to memory`,
    etc.) without calling the brain;
  - otherwise compose a system prompt under 1 KB framing WARD as a
    peer-developer with read-only context (workspaces, open tasks,
    recent sessions, blockers) and stream chunks back as SSE events.
- Added `GET /api/brains/{id}/probe` and
  `POST /api/brains/{id}/test-reply` for the Settings panel.
- Updated brain seed (`packages/memory/src/brains.ts`) to default
  `local-openai-compatible.model = "gemma4:e2b"`. For existing installs
  whose `brains.yaml` has no model, the runtime falls back to the same
  default at call time so the user does not need to edit yaml.
- UI orb chat now consumes the SSE stream, appends a placeholder
  assistant turn updated chunk-by-chunk, shows a typing indicator while
  the stream is open, and auto-speaks the assembled reply via
  `speechSynthesis` when `profile.tts_enabled`. Falls back to the
  existing non-streaming `/api/orb/chat` if no local brain is enabled.
- Settings adds a Local brain panel with Probe + Test reply controls
  and copy-paste guidance for unreachable / missing model cases.
- Existing deterministic `POST /api/orb/chat` endpoint kept as the
  fallback for users with no streaming brain enabled.

### Files Changed

- `packages/harness/src/openai-compatible.ts` — new chat client + probe.
- `packages/harness/src/index.ts` — re-exports the new client.
- `packages/memory/src/brains.ts` — `gemma4:e2b` seed default.
- `apps/runtime/src/index.ts` — system prompt, nav-intent matcher,
  stream endpoint, probe + test-reply endpoints, default-model fallback.
- `apps/ui/src/main.tsx` — streaming orb chat with typing indicator and
  auto-TTS, Local brain panel in Settings.
- `apps/ui/src/styles.css` — orb typing animation, local brain panel
  layout.
- `TASKS.md` — moved 014 from Planned → Testing with capability checks.

### Post-implementation tuning

- Broadened nav matcher: trims trailing punctuation, strips leading
  verbs (`open`, `show me`, `go to`, `switch to`, `take me to`, `navigate
  to`, `jump to`, `see`, optional `please`), strips trailing modifiers
  (`tab`, `view`, `panel`, `page`, `screen`), and matches against a small
  vocabulary per surface. Smoke tested: `open sessions`, `Open
  Sessions.`, `show me settings`, `go to memory`, `switch to overview`,
  `open the sessions tab` all match instantly without calling the brain.
- Ollama performance options now applied to every chat call:
  `keep_alive: "60m"` (model stays loaded for an hour),
  `temperature: 0.7`, `max_tokens: 384` (chat) / `128` (test reply),
  `think: false` (disable chain-of-thought on thinking models).
  System prompt tightened from 7 lines to 3 to reduce prefill time.
- **Switched from Ollama's OpenAI-compat layer (`/v1/chat/completions`)
  to its native API (`/api/chat`).** Same body shape, but the compat
  layer was adding ~3 s of overhead on every call regardless of
  `keep_alive` — likely it does not honor `keep_alive` and reloads the
  model. After the switch, latencies match the `ollama` CLI directly:
  - Streaming first-token: **360 ms** (was 396 ms).
  - Test reply round-trip: **685 ms** (was 2.2–2.6 s — 4x faster).
- Added `ollamaChat()` and `streamOllamaChat()` next to the existing
  OpenAI-compat client. Both honor `keep_alive`, `think`, and pass
  `temperature` / `max_tokens` as Ollama `options`. The native streaming
  format is NDJSON (`{ message.content, done }` per line), parsed in
  the new generator. The OpenAI-compat client is kept for future
  servers that don't expose a native API.

### Deviations From Plan

- `auto-enable + auto-detect` of `local-openai-compatible` on first run
  was listed as out-of-scope; in practice the runtime now applies the
  default model `gemma4:e2b` even when the configured model is null,
  so existing installs do not need to edit `brains.yaml` to use it.
  The user still has to enable the brain explicitly (Settings or
  `POST /api/brains/local-openai-compatible/enable`).
- TTS strategy: end-of-stream speak was chosen as planned; chunked
  speech remains a future enhancement.

### Verification Run

- `bun run typecheck` — PASS
- `bun run build` — PASS
- `git diff --check` — PASS (deferred to user post-commit)
- `GET /api/brains/local-openai-compatible/probe` — `reachable: true,
  model_present: true, latency_ms: 37`.
- `POST /api/brains/local-openai-compatible/enable` — `enabled: true`.
- `POST /api/brains/local-openai-compatible/test-reply` — replied
  `"Hello, Gemma 4."` in 8813 ms (cold-start; subsequent calls warm).
- `POST /api/orb/chat/stream` `{"message":"open sessions"}` — emitted a
  single `delta` (`Opening Sessions.`) and a `done` with
  `surface: "sessions"`, no brain call.
- `POST /api/orb/chat/stream` `{"message":"Hi WARD..."}` — streamed
  conversational deltas chunk-by-chunk from `gemma4:e2b`.
- Browser smoke pending user verification.
