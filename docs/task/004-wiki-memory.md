# Task 004: Git-Backed Wiki Memory

- Status: `done`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 002

## Summary

Create the universal + per-workspace wiki structure as a git-backed
directory tree. Define conventions, support concurrent LLM + human edits via
standard git merging, add simple full-text search over wiki and state, and
wire basic wiki I/O into the Runtime.

## Implementation Notes

- `~/.ward/memory/` is bootstrapped on `ward init` and runtime startup.
- Universal seed pages and `SCHEMA.md` are committed to a local `main`
  branch with `[user] init memory wiki`.
- Workspace creation seeds `workspaces/<slug>/wiki/*.md` and commits
  `[user] workspace: seed <slug>`.
- `GitBackedLocalMemory` implements the `MemoryBackend` seam.
- `SqliteFts5Search` implements the `SearchBackend` seam over wiki pages,
  session summaries, and task contracts as early plan-packet documents.
- LLM writes reject dirty target pages and emit `wiki.conflict_detected`.
- `ward doctor` now verifies memory git integrity with `git fsck`.

## In Scope

### Extension seams (Persistence layer)

This task ships the first implementations of three Persistence-layer
seams from [`001/extension-seams.md`](001/extension-seams.md):

- `MemoryBackend` → `GitBackedLocalMemory` (this task's default impl)
- `SearchBackend` → `SqliteFts5`
- `CacheBackend` → (referenced; 005 builds the full impl)

All consumers (Orchestration, Plan Mode, Brain context assembly) read and
write through these interfaces, **never** through file paths or SQL
directly. The layering lint in 002 enforces this.

```ts
interface MemoryBackend {
  read(scope: Scope, page: string): Promise<MemoryPage>;
  write(scope: Scope, page: string, body: string, author: "user" | "llm"): Promise<void>;
  append(scope: Scope, page: string, section: string, author: "user" | "llm"): Promise<void>;
  history(scope: Scope, page: string): Promise<MemoryCommit[]>;
  snapshot(out: string): Promise<void>;
}

interface SearchBackend {
  index(doc: SearchableDoc): Promise<void>;
  indexBatch(docs: SearchableDoc[]): Promise<void>;
  query(q: string, opts?: { scope?: Scope; limit?: number }): Promise<SearchHit[]>;
  rebuild(): Promise<void>;
}
```

Future `MemoryBackend` impls (e.g. `ClaudeManagedMemory`, `HybridMemory`)
and future `SearchBackend` impls (e.g. vector-based) can swap in without
touching callers.

### Directory layout

```
~/.ward/memory/
  .git/                          # auto-initialized on first bootstrap
  SCHEMA.md                      # wiki conventions (checked in)
  universal/
    index.md
    log.md
    preferences.md
    playbooks.md
    routing.md
  workspaces/
    <workspace-slug>/
      wiki/
        index.md
        log.md
        overview.md
        goals.md
        constraints.md
        decisions.md
        blockers.md
        sessions.md
        plans/                   # one file per approved plan packet
```

### Git backing

- `git init` on first bootstrap.
- All LLM writes use the `[llm] <type>: <title>` commit prefix.
- All human edits use `[user] <summary>` (auto-derived if missing).
- Conflicts: treat as regular git merges. If an LLM edit conflicts with a
  pending human edit, the LLM edit is attempted as a regular commit on a
  temporary branch, then merged into `main`. On conflict, the LLM edit is
  abandoned and a `wiki.conflict_detected` event is emitted with
  suggestions to refresh context.
- Author identity: `WARD Runtime <ward@localhost>` for LLM edits,
  configurable user identity for human edits (defaults from profile).

### Wiki API

- `GET /api/wiki/:scope` — list pages (`universal` or `workspace/<slug>`)
- `GET /api/wiki/:scope/:page` — read
- `PUT /api/wiki/:scope/:page` — write (with `author: "user" | "llm"`)
- `POST /api/wiki/:scope/:page/append` — append section (LLM convenience)
- `GET /api/wiki/:scope/:page/history` — git log for page

### Full-text search

- SQLite FTS5 table mirroring wiki page contents.
- Incremental updates on wiki write; full rebuild via `ward wiki reindex`.
- Search API: `GET /api/search?q=...&scope=...`
- Returns wiki page hits + matching session summaries + matching plan
  packets (all three searched together).

### CLI

- `ward wiki list [--scope universal|<workspace-slug>]`
- `ward wiki read <scope> <page>`
- `ward wiki edit <scope> <page>` — opens `$EDITOR`; commits on save
- `ward wiki history <scope> <page>`
- `ward wiki reindex`
- `ward search <query>`

### UI

- Memory screen: tree of scopes + pages, page viewer with history, search
  bar.
- "Last edited by" chip per page (llm / user).

### Wiki lint (advisory)

- Broken intra-wiki links (`[x](missing.md)`)
- Orphan pages not linked from `index.md`
- Sections older than N days still marked `TBD`
- Run on `ward wiki lint`; emits `system.wiki_lint` events with findings.

## Out of Scope

- Semantic / embedding search (deferred; FTS is sufficient for MVP)
- Automated wiki summarization (lands with 005 Post-session handoff writer)
- Cross-workspace knowledge-graph queries (nice-to-have, post-MVP)

## Acceptance Criteria

1. [x] Fresh init creates memory tree and `.git` repo with an initial commit.
2. [x] Creating a workspace creates its wiki subtree with seed pages.
3. [x] LLM-authored write commits with `[llm]` prefix; human write commits with
   `[user]` prefix.
4. [x] Conflict simulation: external manual edit to a page, then LLM edit of the
   same page — merge succeeds or aborts with `wiki.conflict_detected` event.
5. [x] FTS5 search returns hits across wiki, sessions, and plan packets.
6. [x] `ward wiki lint` flags broken links and orphan pages.
7. [x] Wiki page history API returns correct git log entries.
8. [x] `.git` repo integrity check in `ward doctor` passes.

## Deliverables

- Git-backed `~/.ward/memory/` bootstrap
- Wiki repository layer
- FTS5 schema migration
- Wiki API endpoints
- CLI subcommands
- UI Memory screen
- Lint pass

## Risks

- Git binary not available: detect in `ward doctor` and fail with clear
  install guide. No pure-JS git library for MVP.
- Large wiki pages (several MB) slow FTS indexing: chunked indexing with
  a size warning.

## Verification

- `WARD_HOME=/tmp/ward-codex-task004-smoke bun run ward --json init`
- `WARD_HOME=/tmp/ward-codex-task004-smoke bun run ward --json doctor`
- `WARD_HOME=/tmp/ward-codex-task004-smoke bun run ward --json create-workspace "Task Four Smoke" --description "Wiki memory verification" --repo /Users/eleazarjunsan/Code/Personal/ward`
- `WARD_HOME=/tmp/ward-codex-task004-smoke bun run ward --json wiki list --scope universal`
- `WARD_HOME=/tmp/ward-codex-task004-smoke bun run ward --json wiki list --scope task-four-smoke`
- `WARD_HOME=/tmp/ward-codex-task004-smoke bun run ward --json wiki read task-four-smoke overview.md`
- `WARD_HOME=/tmp/ward-codex-task004-smoke bun run ward --json wiki history task-four-smoke overview.md`
- `WARD_HOME=/tmp/ward-codex-task004-smoke bun run ward --json search verification --scope task-four-smoke`
- `WARD_HOME=/tmp/ward-codex-task004-smoke bun run ward --json wiki lint --scope task-four-smoke`
- `WARD_HOME=/tmp/ward-codex-task004-smoke bun run ward --json wiki reindex`
- API write to `decisions.md` returned 200, committed `[user] wiki: smoke decisions`, and search returned the updated page.
- API append to `sessions.md` with `author: "llm"` returned 200, committed `[llm] wiki: llm session note`, and search returned the appended page.
- Dirty-page LLM write returned 400 with `Wiki conflict detected...`.
- `bun run build`
