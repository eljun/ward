# Task 004: Git-Backed Wiki Memory

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 002

## Summary

Create the universal + per-workspace wiki structure as a git-backed
directory tree. Define conventions, support concurrent LLM + human edits via
standard git merging, add simple full-text search over wiki and state, and
wire basic wiki I/O into the Runtime.

## In Scope

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

1. Fresh init creates memory tree and `.git` repo with an initial commit.
2. Creating a workspace creates its wiki subtree with seed pages.
3. LLM-authored write commits with `[llm]` prefix; human write commits with
   `[user]` prefix.
4. Conflict simulation: external manual edit to a page, then LLM edit of the
   same page — merge succeeds or aborts with `wiki.conflict_detected` event.
5. FTS5 search returns hits across wiki, sessions, and plan packets.
6. `ward wiki lint` flags broken links and orphan pages.
7. Wiki page history API returns correct git log entries.
8. `.git` repo integrity check in `ward doctor` passes.

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
