# Task 003: Workspace State, User Profile, and Attachments

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 002

## Summary

Define and implement the core operational entities in SQLite. Add the user
profile that drives personalized greetings, timezone-aware brief generation,
and presence defaults. Add attachment intake for MVP types (markdown, plain
text, PDF).

## In Scope

### SQLite schema (migration `0002_workspace_state.sql`)

Entities per 001 data-model section, refined:

- `user_profile` (singleton row)
  - id, display_name, honorific (e.g., "captain"), timezone, work_hours_start,
    work_hours_end, quiet_hours_start, quiet_hours_end, persona_tone,
    tts_enabled, tts_voice, tts_rate, tts_pitch, presence_default
- `workspace`
  - id, name, slug, description, status, primary_repo_path, autonomy_level,
    last_opened_at, created_at, updated_at
- `workspace_repo`
  - id, workspace_id, local_path, branch, is_primary, watch_enabled
- `attachment`
  - id, workspace_id, name, source_path, storage_path, kind, bytes,
    created_at
- `task`
  - id, workspace_id, title, description, status, type, priority,
    assignee_kind, plan_packet_id, created_at, updated_at
- `task_contract`
  - id, task_id, goal, constraints_json, acceptance_criteria_json,
    reporting_format, max_iterations, created_at
- `session`
  - id (uuid), workspace_id, task_id, brain_id, runtime_kind, mode,
    lifecycle_state, summary, started_at, ended_at
- `session_event`
  - id, session_id, event_type, trace_id, payload_json, created_at
- `system_event`
  - id, event_type, trace_id, payload_json, created_at
- `preference`
  - id, scope, workspace_id, key, value_json, source, confidence,
    updated_at, UNIQUE(scope, workspace_id, key)
- `schema_version` (already created in 002)

### Attachment intake (MVP)

- Accept markdown, plain text, PDF.
- Copy to `~/.ward/attachments/<workspace_slug>/<attachment_id>/<name>`.
- Extract text (markdown and text: as-is; PDF: text layer via a pure-TS
  PDF library to avoid native deps).
- Store extracted text alongside original; used later by Plan Mode (006).
- Reject other types with a clear message.

### AttachmentIngestor interface (extension seam)

Implement the `AttachmentIngestor` contract from
[`001/extension-seams.md`](001/extension-seams.md):

```ts
interface AttachmentIngestor {
  readonly kinds: string[];        // ["pdf", "application/pdf"]
  extractText(file: Path): Promise<ExtractedText>;
  extractMetadata?(file: Path): Promise<Record<string, unknown>>;
}
```

Ship three default impls (`MarkdownIngestor`, `PlainTextIngestor`,
`PdfTextIngestor`) registered by kind in
`packages/core/attachments/ingestors/`. Future ingestors (URL, image OCR,
audio transcribe, email-thread) add one file without touching the
attachment API.

### Task.external_ref for PM tool integration

- Add `external_ref_json` column to `task` table: optional JSON
  `{ provider, external_id, url }` pointing at a PM tool's native task
  (Linear issue, GitHub issue, Jira ticket, Notion row).
- When set, the UI and CLI show the PM link and sync status.
- Actual PM MCP integration lands in 009; this task only provisions the
  column and repository methods.
- Supports the **hybrid source-of-truth** pattern: WARD owns ephemeral
  session tasks; PM tool owns roadmap. Generated tasks from Plan Mode
  (006) can publish outward via MCP and record the `external_ref`.

### API endpoints

- `POST /api/workspaces` — create
- `GET /api/workspaces` — list
- `GET /api/workspaces/:id` — detail
- `PATCH /api/workspaces/:id` — update (autonomy, description, status)
- `POST /api/workspaces/:id/attachments` — upload
- `GET /api/profile` — read
- `PATCH /api/profile` — update
- `GET /api/preferences` / `PATCH /api/preferences/:scope/:key`

### CLI

- `ward create-workspace <name> [--description ...] [--repo <path>]`
- `ward workspaces` (list)
- `ward workspace <slug>` (detail)
- `ward profile show` / `ward profile set <key> <value>`
- `ward attach <workspace-slug> <path>`

### UI (thin)

- Settings → Profile page (first-run setup)
- Workspaces list
- Workspace detail with attachment list

## Out of Scope

- Wiki memory (004)
- Overview / daily brief (005)
- Plan Mode (006)
- Session creation (007)
- MCP config per workspace (009 uses workspace entity but UI lands there)

## Acceptance Criteria

1. Fresh install prompts for profile on first UI open; profile persists.
2. `ward create-workspace` writes row, creates slug, initializes
   `~/.ward/workspaces/<slug>/` directory.
3. Workspace list and detail APIs return expected data; CLI matches.
4. Attachments: uploading a markdown, text, and PDF each succeed and show
   extracted text in detail.
5. Unsupported attachment types are rejected with clear error.
6. Autonomy level defaults to `standard`, settable per workspace.
7. All new tables pass migration idempotency check (run twice, no error).
8. All endpoints require device-token auth; no request without it succeeds.

## Deliverables

- Migration file `0002_workspace_state.sql`
- Repository layer in `packages/memory` (workspace, task, session,
  attachment, preference)
- API handlers and Zod schemas in `apps/runtime`
- CLI subcommands above
- UI Settings → Profile + workspace list + detail (minimal styling)

## Risks

- PDF text extraction in pure TS may miss complex layouts. Document as
  "MVP — text layer only" and defer OCR.
- Slug collisions: collision-safe `slugify` with numeric suffix on conflict.
