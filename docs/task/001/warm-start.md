# Appendix: Warm-Start and Precompute Pipeline

WARD's conversational UX must feel like opening a game, not like booting a
web app. When the user opens the UI or asks "get me up to speed", the first
token of the response must arrive in under **500 ms**. This is impossible
if the Runtime scans SQLite, reads wiki files, diffs repos, and summarizes
history on demand.

The solution is a **warm cache** maintained by a precompute pipeline. The
Runtime precomputes expensive artifacts continuously (on events) and eagerly
(on startup). Conversational and overview flows read from cache only.

## Principles

1. **Precompute on change, not on query.** Every cacheable artifact has one
   or more invalidation events. The Runtime refreshes the cache when those
   events fire, never when the user asks.
2. **Cache is an implementation detail.** API consumers see a single
   `overview` / `briefing` / `context-packet` endpoint; cache is hidden.
3. **Fall-through to compute is allowed but logged.** If the cache is cold
   (fresh install, first boot after restart), the Runtime computes and
   populates — and emits a `warmcache.missed` event so we can tune.
4. **Bounded memory.** Cache is LRU with a configurable ceiling (default
   256 MB).
5. **Persisted across restarts.** Cache snapshots to
   `~/.ward/cache/<key>.json` on graceful shutdown and cold-loads on
   startup.

## Cached Artifacts

| Key | Scope | Size | Invalidation events |
|---|---|---|---|
| `daily_brief` | install-wide, per local-tz day | ~10 KB | `session.completed`, `session.failed`, `git.commit`, `plan.decision`, midnight tz rollover |
| `workspace_summary:<id>` | per workspace | ~5 KB | `session.completed` in workspace, `git.*` on linked repos, `plan.decision`, wiki page change in workspace |
| `context_packet:<workspace_id>` | per workspace | ~30 KB | same as `workspace_summary`, plus `fs.file_written` within workspace, preference change |
| `repo_snapshot:<repo_id>` | per linked repo | ~50 KB | `git.branch_changed`, `git.commit`, fs change detected by watcher, daily refresh |
| `wiki_index:<scope>` | per wiki scope | ~100 KB | any wiki write |
| `wiki_search_index` | install-wide | up to ~50 MB | batched wiki changes (debounced 30 s) |
| `recent_sessions:<workspace_id>` | per workspace, last N | ~10 KB | `session.completed`, `session.failed` |
| `active_blockers:<workspace_id>` | per workspace | ~2 KB | `session.blocked`, `worker.needs_permission`, user clear action |
| `cost_ledger_today` | per brain, per day | ~1 KB | `brain.call_completed`, midnight rollover |
| `mcp_effective_set:<workspace_id>` | per workspace | ~5 KB | any MCP config change in any scope relevant to workspace |

## Prewarm on Daemon Startup

On `runtime.started`:

1. Open SQLite, verify schema, apply migrations if needed.
2. Load cache snapshot from `~/.ward/cache/`. Entries older than their max
   TTL are discarded.
3. Launch **prewarm tasks** in parallel (non-blocking — the Runtime is
   answering requests before prewarm finishes):
   - Compute `daily_brief` for today.
   - Compute `workspace_summary` for the **last-opened** workspace.
   - Compute `active_blockers` for all active workspaces.
   - Compute `recent_sessions` for the last-opened workspace.
   - Verify `repo_snapshot` freshness for linked repos; refresh in
     background if stale.
   - Verify MCP `tools/list` for enabled servers (via `ward mcp doctor`
     inline).
4. Start event listeners (git watchers, scheduler, MCP proxy warm-up).

Prewarm progress is surfaced via `warmcache.refreshed` events. The UI may
show a "loading" chrome on first open if a visited screen hits a cold key,
but the **daily brief path is hot by the time the UI asks for it in
normal flow** because the user opens the UI after the CLI has already
auto-started the daemon.

### Cold Start SLA

| Phase | Target |
|---|---|
| Daemon process up | < 300 ms |
| Accepting HTTP | < 500 ms |
| `daily_brief` cache warm | < 3 s |
| All active workspaces warm | < 10 s |
| Search index warm | < 30 s |

Slower computers target 2–3× these numbers; they remain acceptable.

## Event-Driven Refresh

After prewarm, the cache stays warm via event subscriptions. Example chain:

```
git.commit in linked-repo(workspace=X)
  → invalidate: workspace_summary:X, repo_snapshot:repo_id, daily_brief
  → schedule refresh (debounced 1 s per key to coalesce bursts)
  → on refresh done: emit warmcache.refreshed
```

Debouncing rules:

- Rapid-fire events (e.g., 20 file saves from a worker) trigger **one**
  refresh per key after a 1 s quiet window.
- High-priority invalidations (`session.completed`) refresh immediately.
- Low-priority (fs watcher churn) refresh lazily (up to 10 s).

## Computation Details

### `daily_brief`

Assembled from:

- active workspaces (status = active, updated within 14 days)
- sessions completed or failed since last local-tz 00:00
- open blockers
- next-action cards from recent Post-session outputs
- upcoming scheduled runs (if any)

Computed in two layers:

1. **Structured** brief (deterministic JSON): counts, lists, status flags.
   Computed directly from SQLite + cache keys. Takes ~50 ms.
2. **Narrated** brief (prose): run through Orchestrator recap-and-brief
   brain with the structured brief as input. Takes ~1 s on a fast local
   model, 2–3 s on API. Caches the narration; regenerates if structured
   changed meaningfully (content diff).

The UI renders the structured brief instantly and streams the narration
when ready.

### `context_packet:<workspace_id>`

Built from:

- `workspace_summary:<workspace_id>`
- top 5 wiki pages from `wiki_index` ranked by relevance to last N events
  plus user-pinned pages
- `active_blockers:<workspace_id>`
- current task contract if any
- `preferences_excerpt` (scoped to workspace)
- `repo_snapshot:<repo_id>` reference (not full content; a path)
- trace id

Size budget: 30 KB. Hard cap: 60 KB. If over budget, drop wiki pages
beyond top 3, truncate summary to last 3 sessions.

### `repo_snapshot:<repo_id>`

Computed by the Runtime's git/fs watcher:

- file tree (top-N largest dirs, configurable)
- list of "key files" (package.json, pyproject.toml, tsconfig.json,
  README.md, Dockerfile, primary entry points inferred from manifests)
- light symbol map: top-level exports / classes / functions per language,
  via `tree-sitter` (cheap, no LSP required)
- last 10 commits (oneline + file-stat)
- current branch and diff summary vs default branch

Refresh on: `git.branch_changed`, `git.commit`, periodic (15 min) if
watcher missed events, manual `ward workspace refresh`.

### `wiki_search_index`

- Full-text index (SQLite FTS5) over all wiki pages.
- Fields: title, body, scope (universal / workspace-<slug>), last-updated.
- Rebuilt incrementally on wiki writes; full rebuild nightly.

### `mcp_effective_set:<workspace_id>`

The resolved MCP server set (three-scope merge) for a workspace. Used by
`ward mcp list`, harness launch, and Orchestrator tool-use context. Cheap
to compute (~5 ms) but cached to avoid re-parsing `.mcp.json` on every
call.

## Persistence

- Cache snapshots write to `~/.ward/cache/<key>.json` on graceful shutdown.
- On crash-recovery startup (no snapshot), Runtime emits
  `runtime.crashed` and rebuilds from events + SQLite.
- Cache format is versioned. Version mismatch drops the entry silently.

## Freshness and TTLs

Each key has an invalidation-event set (see table above). Additionally,
every entry carries a soft TTL:

- `daily_brief`: 1 h (prose regenerated even without events, so narration
  stays current if we pass local-tz boundary in-process)
- `workspace_summary`: 6 h
- `context_packet`: 15 min (to avoid stale pref / wiki refs)
- `repo_snapshot`: 15 min hard (watcher-driven is primary)
- `wiki_search_index`: nightly full rebuild
- `mcp_effective_set`: 24 h (config changes are event-driven)

TTLs are insurance against missed invalidation events, not the primary
freshness mechanism.

## Observability

- Hit rate per key exposed via `ward doctor --warm-stats`.
- SSE event `warmcache.refreshed` with key + duration_ms.
- SSE event `warmcache.missed` when a read hit cold cache and had to
  compute synchronously. Target: < 1 % of reads after steady-state.

## Testing

- Unit tests per key's invalidation set: given event X, cache key Y is
  marked stale.
- Fuzz test: random event streams never leave the cache in an inconsistent
  state (all dependent keys eventually converge).
- SLA tests: cold start on a fresh install reaches "daily brief warm" in
  under 3 s.
- Memory bound tests: synthetic workload of 500 workspaces stays under
  the configured cache ceiling.

## Open Implementation Details (flagged for 005)

- Exact ranking function for "top wiki pages for context" (embedding later
  vs FTS-only first).
- Debounce tunings (may need tuning after real-world event rates measured).
- Prewarm priority order when user has pinned workspaces in preferences.
