# Task 017: Richer + Configurable Orb Context — Test Report

- Date: 2026-05-15
- Result: PASS
- Runtime home: `/tmp/ward-task017-smoke`
- Runtime port: `47730`

## Scope

Verified Task 017 against the acceptance criteria in
`docs/task/017-configurable-orb-context.md`: configurable orb context
preferences, default prompt specificity, disabled session context,
test-reply preview prompt, reset/default persistence, static checks,
and Settings UI presence.

## Commands

- `bun run typecheck` — PASS
- `bun run build` — PASS
- `git diff --check` — PASS
- `bun test` — SKIPPED (Bun returned "No tests found"; the repo has
  no `*.test.ts` / `*.spec.ts` files yet)
- `WARD_HOME=/tmp/ward-task017-smoke bun run ward --json init` — PASS
- `WARD_HOME=/tmp/ward-task017-smoke bun run ward --json up` — PASS
  with escalation for localhost port binding
- `WARD_HOME=/tmp/ward-task017-smoke bun run ward --json brain enable local-openai-compatible` — PASS
- `curl /api/preferences` plus six `PATCH /api/preferences/global/{key}` calls — PASS
- `curl /api/brains/local-openai-compatible/test-reply` with
  `system_prompt` — PASS after local Ollama model warm-up
- `curl -N /api/orb/chat/stream` with `what should I work on?` — PASS
- Browser smoke of `http://127.0.0.1:47730` Settings modal — PASS

## Evidence

- Default context stream after seeding workspace `Task Seventeen Smoke`
  and task `Tune orb context prompt` replied with both:
  `Task Seventeen Smoke` and `Tune orb context prompt`.
- With `orb.context.include_sessions=false`, asking
  `did anything finish recently?` replied that recent session details
  were not available right now, then suggested the seeded workspace/task.
- Reset wrote all six preference keys to defaults:
  `orb.system_prompt_override=""`,
  `include_workspaces=true`,
  `include_tasks=true`,
  `include_sessions=true`,
  `include_wiki=false`,
  `token_budget=800`.
- Test reply with an unsaved `system_prompt` returned `Hey!` in
  `778 ms` once `gemma4:e4b` was warm. A preceding cold run timed out
  at the endpoint's 15 s timeout; direct Ollama timing showed about
  17 s cold load, so this was model warm-up latency rather than a
  request-shape failure.
- Browser smoke found exactly one Settings `Orb context` card, one
  system-instruction textarea, workspace/session toggles, Reset and
  Test reply buttons, and no browser console errors.
- Filling the system-instruction textarea with
  `You are a terse assistant. Reply in haiku.` updated the live token
  label to `~ 231 / 800 tokens`.

## Notes

- The first default-context stream named the open task but not the
  workspace. The runtime prompt was tightened, then the stream was
  rerun successfully.
- The smoke runtime had to be started with sandbox escalation because
  port binding to WARD's localhost range is blocked in the default
  sandbox.
- Full manual haiku/persona quality was not judged beyond endpoint/UI
  wiring because local LLM phrasing is nondeterministic. The unsaved
  `system_prompt` path was verified through the test-reply endpoint.
