# Task 006: Plan Mode and Code-Context Service

- Status: `done`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 004, 005

## Summary

Implement Plan Mode as a moderated multi-round planning workflow per
`001/plan-packet-schema.md`. Ship with **simulated participant adapters**
so the full UI and flow are testable without real model spend. Add the
Code-Context Service that assembles repo structure for Plan Mode and Brain
calls per `001/warm-start.md`.

## Implementation Notes

- `packages/core/src/plan/index.ts` defines the Plan Packet, round output,
  session, and repo snapshot schemas with Zod validation.
- `packages/memory/src/plan.ts` implements the deterministic Plan Mode engine:
  context, proposal, critique, convergence, and decision rounds with three
  simulated participants.
- Plan state is durable in SQLite (`plan_session`, `plan_packet`,
  `plan_round_transcript`) and round transcripts are written to
  `~/.ward/sessions/<plan_session_id>/rounds/`.
- Approved packets render to
  `memory/workspaces/<slug>/wiki/plans/<packet_id>.md` and commit as `[llm]`.
- `generate-tasks` creates `task` and `task_contract` rows, links each task
  with `plan_packet_id`, and writes hard-memory task docs under
  `~/.ward/workspaces/<slug>/tasks/`.
- `packages/memory/src/code-context.ts` snapshots linked repos with bounded
  file trees, key files, recent commits, diff summary, and a lightweight
  regex-based symbol map. Runtime startup refreshes snapshots and polls for
  changed git heads every 2 seconds.
- External PM publishing is intentionally a stub until MCP connections land in
  Task 009.

## In Scope

### Plan Mode engine

- Round state machine: `context → proposal → critique → convergence → decision`.
- Deterministic simulated participant orchestration for this phase.
- Moderator workflow: synthesis between rounds, clarifying-question routing
  to user.
- Strict JSON schema validation per round (Zod).
- Plan Packet persistence:
  - SQLite: `plan_packet` table, `plan_round_transcript` blob rows
  - Wiki: `memory/workspaces/<slug>/wiki/plans/<packet_id>.md`
  - Sessions: `~/.ward/sessions/<plan_session_id>/rounds/<N>-<round>.json`
- Versioning: revisions bump `version`; `supersedes` points at prior
  packet_id.
- Task generation from approved packets (creates `task` + `task_contract`
  rows, links to plan via `plan_packet_id`).
- Generated task docs include the stable hard-memory sections from
  [`001/agent-contract.md`](001/agent-contract.md): WARD Metadata, Agent
  Signals, Implementation Claims, QA Evidence, Harness Critique, and Open
  Risks.
- **Convergence policy** per workspace: `consensus` (default),
  `coordinator_decides` (ARIA-style), `user_decides`. See
  [`001/plan-packet-schema.md`](001/plan-packet-schema.md). Task 006 exposes
  policy selection at plan start; workspace-level defaults can follow after
  the settings surface grows.
- **Publish to PM tool** endpoint exists but returns a clear not-configured
  result until MCP connections land in Task 009.

### Simulated participants

- Deterministic, seeded adapter that returns canned responses keyed by
  round and participant id.
- Canned responses produce schema-valid outputs for every round.
- Adapter registered in Brain Registry with `runtime: local` and
  `kind: simulated`.
- Used for 006 acceptance; real brains swap in via 008.

### Code-Context Service

- Watches linked repos (primary repo always, secondaries opt-in).
- Cached artifact `repo_snapshot:<repo_id>`:
  - file tree (bounded)
  - key files list (from manifest detection)
  - light symbol map via regex extraction
  - last 10 commits oneline + stat
  - branch + diff vs default branch summary
- Git watcher: runtime polling every 2 s plus manual
  `ward workspace refresh`.
- Refresh on branch change, commit, or manual `ward workspace refresh`.
- Used by Plan Mode (Context round) and by Orchestrator Brain when code
  context is needed for conversational mode in a workspace.

### API

- `POST /api/plan/:workspace_id_or_slug/start` — opens plan session with
  simulated participants
- `GET /api/plan/:plan_id` — current state + round transcripts
- `POST /api/plan/:plan_id/answer` — user answers clarifying questions
- `POST /api/plan/:plan_id/approve` — user approves packet
- `POST /api/plan/:plan_id/revise` — user requests revision with notes
- `POST /api/plan/:plan_id/abort`
- `POST /api/plan/:plan_id/generate-tasks` — create tasks from approved
  packet
- `POST /api/plan/:plan_id/publish-tasks-external` — publish generated
  tasks to a configured PM tool (Linear / GitHub / Jira / Notion) via
  MCP, record the returned URLs in `task.external_ref_json`. Opt-in per
  workspace.

### CLI

- `ward plan start <workspace-slug>`
- `ward plan status <plan-id>`
- `ward plan approve <plan-id>` / `ward plan revise <plan-id>`
- `ward plan generate-tasks <plan-id>`

### UI

- Plan Mode screen:
  - Round progress indicator
  - Participant panels (one column per participant)
  - Moderator synthesis panel
  - Attachments panel
  - Clarifying-question inbox
  - Decision review with approve / revise / abort

## Out of Scope

- Real external brains (008)
- Learning from plan outcomes (011)
- Cross-workspace plan search / templates (post-MVP)

## Acceptance Criteria

1. Starting Plan Mode on a workspace with an attachment and a linked repo
   completes all 5 rounds using simulated participants.
2. Plan Packet validates against Zod schema on every write.
3. Approved packet is persisted to SQLite and renders as markdown to
   `wiki/plans/<packet_id>.md` with an `[llm]` git commit.
4. `generate-tasks` creates `task` rows and `task_contract` rows for each
   packet task entry.
5. Generated task docs include the required WARD hard-memory sections.
6. Clarifying questions from a simulated participant route to the user and
   the user's answer resumes the round.
7. Revising an approved packet bumps `version` and leaves history readable.
8. Code-Context Service refreshes snapshot within 2 s of a git commit in a
   linked repo.
9. Plan Mode session survives Runtime restart (state restored from events +
   session directory).

## Deliverables

- Plan Mode engine + round handlers
- Simulated participant adapter
- Code-Context Service + watchers + snapshot cache
- Migration `0005_plan_packets.sql`
- API + CLI + UI

## Verification

- `bun run typecheck`
- `bun run build:ui`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json init`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json up`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json create-workspace "Task Six Smoke" --description "Plan mode smoke" --repo /Users/eleazarjunsan/Code/Personal/ward`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json attach task-six-smoke README.md`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json workspace refresh task-six-smoke`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json plan start task-six-smoke --prompt "Plan Task 006 smoke validation"`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json plan approve packet_2396233a8ac54f47`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json plan generate-tasks packet_2396233a8ac54f47`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json wiki history task-six-smoke plans/packet_2396233a8ac54f47.md`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json plan revise packet_2396233a8ac54f47 "Tighten scope before execution."`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json plan status packet_2396233a8ac54f47`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json plan start task-six-smoke --prompt "Clarify the planning tradeoff" --clarify`
- `WARD_HOME=/tmp/ward-codex-task006-smoke bun run ward --json plan answer plan_f548fed7e55740b3 "Optimize safety first, then scope."`
- Temp git repo watcher smoke: initial snapshot head
  `7106ed001f23f40285a19f7e6976bd8674919f02`, new commit
  `3401d8079e33852786bf5b3bd0e367cf40dcecbf`, watcher snapshot refreshed
  to the new head after a 3 s wait.
- Runtime restart verified with `ward down`, `ward up`, and
  `ward plan status packet_2396233a8ac54f47`.

## Risks

- `tree-sitter` parser install per language. Start with TS/JS, Python, Go,
  Rust, add others on demand. Fall back to file-listing-only if parser
  missing.
- Participant timeouts during rounds: coalesce partials, Moderator handles
  absentees, packet `source` records it.
