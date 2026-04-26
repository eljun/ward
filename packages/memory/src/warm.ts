import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DailyBriefSchema,
  OutcomeRecordSchema,
  OverviewSchema,
  SimulateSessionSchema,
  WardSessionSchema,
  WarmCacheStatsSchema,
  createEvent,
  createTraceId,
  nowIso,
  type BriefRange,
  type BriefSessionSummary,
  type BriefTaskSignal,
  type BriefWorkspace,
  type DailyBrief,
  type OutcomeRecord,
  type Overview,
  type SimulateSessionInput,
  type WardEvent,
  type WardSession,
  type WarmCacheEntryMeta,
  type WarmCacheStats
} from "@ward/core";
import type { Database } from "bun:sqlite";
import { ensureWardLayout, resolveWardPaths, type WardPaths } from "./layout.ts";
import { openWardDatabase } from "./migrations.ts";
import { appendWikiPage, ensureMemoryBootstrap, wikiPageHistory } from "./wiki.ts";

type ProfileRow = {
  display_name: string;
  honorific: string | null;
  timezone: string;
  tts_enabled: number;
  tts_voice: string | null;
  tts_rate: number;
  tts_pitch: number;
};

type WorkspaceRow = {
  id: number;
  name: string;
  slug: string;
  status: string;
  last_opened_at: string | null;
  updated_at: string;
};

type SessionRow = WardSession;

type OutcomeRow = Omit<OutcomeRecord, "key_changes" | "artifacts" | "blockers"> & {
  key_changes_json: string;
  artifacts_json: string;
  blockers_json: string;
};

type WarmCacheEntry = {
  key: string;
  value: unknown;
  stale: boolean;
  refreshed_at: string;
  expires_at: string;
  hits: number;
  misses: number;
  size_bytes: number;
};

type ComputeOptions<T> = {
  key: string;
  ttlMs: number;
  reason: string;
  compute: () => Promise<T>;
};

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const SHORT_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const TERMINAL_TASK_STATUSES = new Set(["shipped", "done", "canceled"]);

function withDb<T>(fn: (db: Database, paths: WardPaths) => T): T {
  const paths = resolveWardPaths();
  const db = openWardDatabase(paths);
  try {
    return fn(db, paths);
  } finally {
    db.close();
  }
}

async function withDbAsync<T>(fn: (db: Database, paths: WardPaths) => Promise<T>): Promise<T> {
  const paths = resolveWardPaths();
  const db = openWardDatabase(paths);
  try {
    return await fn(db, paths);
  } finally {
    db.close();
  }
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function jsonArray(value: string): string[] {
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function outcomeFromRow(row: OutcomeRow): OutcomeRecord {
  return OutcomeRecordSchema.parse({
    id: row.id,
    session_id: row.session_id,
    workspace_id: row.workspace_id,
    task_id: row.task_id,
    status: row.status,
    outcome_summary: row.outcome_summary,
    key_changes: jsonArray(row.key_changes_json),
    artifacts: jsonArray(row.artifacts_json),
    blockers: jsonArray(row.blockers_json),
    handoff: row.handoff,
    wiki_commit: row.wiki_commit,
    created_at: row.created_at
  });
}

function sessionFromRow(row: SessionRow): WardSession {
  return WardSessionSchema.parse(row);
}

function recordSystemEvent(db: Database, event: WardEvent): void {
  db.query(`
    INSERT INTO system_event (id, event_type, trace_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(event.event_id, event.event_type, event.trace_id, JSON.stringify(event.payload), event.timestamp);
}

function recordWarmEvent(event_type: "warmcache.refreshed" | "warmcache.missed", payload: Record<string, unknown>): void {
  withDb((db) => recordSystemEvent(db, createEvent({
    event_type,
    trace_id: createTraceId("warm"),
    workspace_id: typeof payload.workspace_id === "number" ? payload.workspace_id : null,
    session_id: null,
    source: "runtime",
    payload
  })));
}

function localDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function targetDate(range: BriefRange, timezone: string): string {
  const date = new Date();
  if (range === "yesterday") {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return localDate(date, timezone);
}

function durationMs(startedAt: string, endedAt: string | null): number {
  if (!endedAt) {
    return 0;
  }
  return Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function profile(db: Database): ProfileRow {
  const row = db.query<ProfileRow, []>(`
    SELECT display_name, honorific, timezone, tts_enabled, tts_voice, tts_rate, tts_pitch
    FROM user_profile
    WHERE id = 'self'
  `).get();
  return row ?? {
    display_name: "",
    honorific: null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    tts_enabled: 0,
    tts_voice: null,
    tts_rate: 1,
    tts_pitch: 1
  };
}

function activeWorkspaces(db: Database): BriefWorkspace[] {
  return db.query<WorkspaceRow & { open_tasks: number; blockers: number }, []>(`
    SELECT workspace.id, workspace.name, workspace.slug, workspace.status, workspace.last_opened_at,
      workspace.updated_at,
      COALESCE(SUM(CASE
        WHEN task.id IS NOT NULL AND task.status NOT IN ('shipped', 'done', 'canceled') THEN 1
        ELSE 0
      END), 0) AS open_tasks,
      COALESCE(SUM(CASE
        WHEN task.status IN ('blocked', 'needs_user', 'needs_work') THEN 1
        ELSE 0
      END), 0) AS blockers
    FROM workspace
    LEFT JOIN task ON task.workspace_id = workspace.id
    WHERE workspace.status = 'active'
    GROUP BY workspace.id
    ORDER BY workspace.last_opened_at DESC, workspace.updated_at DESC
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    open_tasks: Number(row.open_tasks),
    blockers: Number(row.blockers)
  }));
}

function taskBlockers(db: Database): BriefTaskSignal[] {
  return db.query<{
    workspace_id: number;
    workspace_slug: string;
    workspace_name: string;
    task_id: string;
    title: string;
    status: string;
    priority: string;
  }, []>(`
    SELECT workspace.id AS workspace_id, workspace.slug AS workspace_slug, workspace.name AS workspace_name,
      task.id AS task_id, task.title, task.status, task.priority
    FROM task
    JOIN workspace ON workspace.id = task.workspace_id
    WHERE task.status IN ('blocked', 'needs_user', 'needs_work')
    ORDER BY
      CASE task.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      task.updated_at DESC
  `).all().map((row) => ({
    ...row,
    reason: row.status === "needs_user" ? "Waiting for your decision." : row.status === "needs_work" ? "Needs more implementation work." : "Blocked."
  }));
}

function recentSessionsForDate(db: Database, timezone: string, date: string): BriefSessionSummary[] {
  return db.query<SessionRow & { workspace_slug: string | null }, []>(`
    SELECT session.*, workspace.slug AS workspace_slug
    FROM session
    LEFT JOIN workspace ON workspace.id = session.workspace_id
    WHERE session.ended_at IS NOT NULL
    ORDER BY session.ended_at DESC
    LIMIT 50
  `).all()
    .filter((row) => row.ended_at && localDate(new Date(row.ended_at), timezone) === date)
    .map((row) => ({
      id: row.id,
      workspace_id: row.workspace_id,
      workspace_slug: row.workspace_slug,
      task_id: row.task_id,
      status: row.lifecycle_state ?? "unknown",
      summary: row.summary ?? "",
      duration_ms: durationMs(row.started_at, row.ended_at),
      ended_at: row.ended_at
    }));
}

function nextActions(db: Database, blockers: BriefTaskSignal[]): Array<{ workspace_slug: string | null; task_id: string | null; title: string; action: string }> {
  if (blockers.length > 0) {
    return blockers.slice(0, 3).map((blocker) => ({
      workspace_slug: blocker.workspace_slug,
      task_id: blocker.task_id,
      title: blocker.title,
      action: blocker.reason
    }));
  }

  return db.query<{
    workspace_slug: string;
    task_id: string;
    title: string;
    status: string;
  }, []>(`
    SELECT workspace.slug AS workspace_slug, task.id AS task_id, task.title, task.status
    FROM task
    JOIN workspace ON workspace.id = task.workspace_id
    WHERE task.status NOT IN ('shipped', 'done', 'canceled')
    ORDER BY
      CASE task.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      task.updated_at DESC
    LIMIT 3
  `).all().map((task) => ({
    workspace_slug: task.workspace_slug,
    task_id: task.task_id,
    title: task.title,
    action: task.status === "idea" ? "Plan the task contract." : "Resume this task."
  }));
}

function recentHandoffs(db: Database, limit = 5): OutcomeRecord[] {
  return db.query<OutcomeRow, [number]>("SELECT * FROM outcome_record ORDER BY created_at DESC LIMIT ?")
    .all(limit)
    .map(outcomeFromRow);
}

function runningSessions(db: Database): WardSession[] {
  return db.query<SessionRow, []>(`
    SELECT * FROM session
    WHERE lifecycle_state IN ('queued', 'running', 'paused', 'blocked')
    ORDER BY started_at DESC
  `).all().map(sessionFromRow);
}

function buildNarration(data: {
  displayName: string;
  honorific: string | null;
  workspaces: BriefWorkspace[];
  blockers: BriefTaskSignal[];
  completed: number;
  failed: number;
  nextActionCount: number;
}): string {
  const name = [data.honorific, data.displayName].filter(Boolean).join(" ").trim();
  const greeting = name ? `Hey ${name}` : "Hey";
  const workspaceText = `${data.workspaces.length} active workspace${data.workspaces.length === 1 ? "" : "s"}`;
  const blockerText = data.blockers.length > 0
    ? `${data.blockers.length} blocker${data.blockers.length === 1 ? "" : "s"} need attention`
    : "no blockers are open";
  const sessionText = data.completed || data.failed
    ? `${data.completed} completed and ${data.failed} failed session${data.completed + data.failed === 1 ? "" : "s"} today`
    : "no sessions have closed yet today";
  return `${greeting}, WARD is warm. You have ${workspaceText}, ${blockerText}, and ${sessionText}. I found ${data.nextActionCount} next action${data.nextActionCount === 1 ? "" : "s"} ready when you are.`;
}

function computeDailyBrief(db: Database, range: BriefRange): DailyBrief {
  const user = profile(db);
  const timezone = user.timezone || "UTC";
  const date = targetDate(range, timezone);
  const workspaces = activeWorkspaces(db);
  const blockers = taskBlockers(db);
  const sessions = recentSessionsForDate(db, timezone, date);
  const completed = sessions.filter((session) => session.status === "completed").length;
  const failed = sessions.filter((session) => session.status === "failed").length;
  const actions = nextActions(db, blockers);
  const openTasks = workspaces.reduce((sum, workspace) => sum + workspace.open_tasks, 0);
  const structured = {
    date,
    workspaces,
    blockers,
    sessions,
    actions,
    openTasks
  };
  const displayName = user.display_name || "there";
  const greetingName = [user.honorific, displayName].filter(Boolean).join(" ").trim();
  const brief = DailyBriefSchema.parse({
    key: `daily_brief:${date}`,
    local_date: date,
    range,
    timezone,
    generated_at: nowIso(),
    structured_hash: stableHash(structured),
    greeting: `Hey ${greetingName}`,
    narration: buildNarration({
      displayName,
      honorific: user.honorific,
      workspaces,
      blockers,
      completed,
      failed,
      nextActionCount: actions.length
    }),
    speak: Boolean(user.tts_enabled),
    counts: {
      active_workspaces: workspaces.length,
      open_tasks: openTasks,
      blockers: blockers.length,
      sessions_completed: completed,
      sessions_failed: failed
    },
    workspaces,
    blockers,
    next_actions: actions,
    sessions: {
      completed,
      failed,
      recent: sessions.slice(0, 5)
    },
    calendar: null
  });
  return brief;
}

function computeWorkspaceSummary(db: Database, workspaceId: number): unknown {
  const workspace = db.query<WorkspaceRow, [number]>("SELECT * FROM workspace WHERE id = ?").get(workspaceId);
  if (!workspace) {
    throw new Error("Workspace not found");
  }
  const openTasks = db.query<{ count: number }, [number, ...string[]]>(
    `SELECT COUNT(*) AS count FROM task WHERE workspace_id = ? AND status NOT IN (${Array.from(TERMINAL_TASK_STATUSES).map(() => "?").join(", ")})`
  ).get(workspaceId, ...Array.from(TERMINAL_TASK_STATUSES))?.count ?? 0;
  const blockers = taskBlockers(db).filter((blocker) => blocker.workspace_id === workspaceId);
  return {
    workspace,
    open_tasks: openTasks,
    blockers,
    recent_handoffs: recentHandoffs(db, 10).filter((handoff) => handoff.workspace_id === workspaceId),
    generated_at: nowIso()
  };
}

function safeCacheFile(paths: WardPaths, key: string): string {
  const slug = key.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 80);
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 10);
  return join(paths.cacheDir, `${slug}-${hash}.json`);
}

class LocalWarmCache {
  private entries = new Map<string, WarmCacheEntry>();
  private loaded = false;
  private reads = 0;
  private hits = 0;
  private misses = 0;

  constructor(private readonly paths: WardPaths = resolveWardPaths()) {}

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await ensureWardLayout(this.paths);
    if (!existsSync(this.paths.cacheDir)) {
      this.loaded = true;
      return;
    }
    const entries = await readdir(this.paths.cacheDir).catch(() => []);
    for (const entry of entries.filter((name) => name.endsWith(".json"))) {
      const path = join(this.paths.cacheDir, entry);
      try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as WarmCacheEntry;
        if (parsed.key && parsed.expires_at && new Date(parsed.expires_at).getTime() > Date.now()) {
          this.entries.set(parsed.key, parsed);
        }
      } catch {
        // Corrupt cache snapshots are ignored; recompute wins.
      }
    }
    this.loaded = true;
    this.evict();
  }

  async get<T>(options: ComputeOptions<T>): Promise<T> {
    await this.load();
    this.reads += 1;
    const existing = this.entries.get(options.key);
    if (existing && !existing.stale && new Date(existing.expires_at).getTime() > Date.now()) {
      existing.hits += 1;
      this.hits += 1;
      this.entries.delete(options.key);
      this.entries.set(options.key, existing);
      await this.persist(existing);
      return existing.value as T;
    }

    this.misses += 1;
    if (existing) {
      existing.misses += 1;
    }
    recordWarmEvent("warmcache.missed", { key: options.key, reason: options.reason });
    return this.refresh(options);
  }

  async refresh<T>(options: ComputeOptions<T>): Promise<T> {
    await this.load();
    const started = Date.now();
    const value = await options.compute();
    const serialized = JSON.stringify(value);
    const entry: WarmCacheEntry = {
      key: options.key,
      value,
      stale: false,
      refreshed_at: nowIso(),
      expires_at: new Date(Date.now() + options.ttlMs).toISOString(),
      hits: this.entries.get(options.key)?.hits ?? 0,
      misses: this.entries.get(options.key)?.misses ?? 0,
      size_bytes: Buffer.byteLength(serialized)
    };
    this.entries.set(options.key, entry);
    this.evict();
    await this.persist(entry);
    recordWarmEvent("warmcache.refreshed", {
      key: options.key,
      reason: options.reason,
      duration_ms: Date.now() - started,
      size_bytes: entry.size_bytes
    });
    return value;
  }

  invalidate(predicate: (key: string) => boolean): void {
    for (const entry of this.entries.values()) {
      if (predicate(entry.key)) {
        entry.stale = true;
      }
    }
  }

  stats(): WarmCacheStats {
    const entries: WarmCacheEntryMeta[] = Array.from(this.entries.values()).map((entry) => ({
      key: entry.key,
      stale: entry.stale,
      refreshed_at: entry.refreshed_at,
      expires_at: entry.expires_at,
      hits: entry.hits,
      misses: entry.misses,
      size_bytes: entry.size_bytes
    }));
    const hitRate = this.reads === 0 ? 1 : this.hits / this.reads;
    return WarmCacheStatsSchema.parse({
      entries,
      reads: this.reads,
      hits: this.hits,
      misses: this.misses,
      hit_rate: hitRate,
      miss_rate: this.reads === 0 ? 0 : this.misses / this.reads,
      generated_at: nowIso()
    });
  }

  private async persist(entry: WarmCacheEntry): Promise<void> {
    await mkdir(this.paths.cacheDir, { recursive: true, mode: 0o700 });
    await writeFile(safeCacheFile(this.paths, entry.key), JSON.stringify(entry, null, 2), "utf8");
  }

  private evict(): void {
    let total = Array.from(this.entries.values()).reduce((sum, entry) => sum + entry.size_bytes, 0);
    while (total > MAX_CACHE_BYTES && this.entries.size > 0) {
      const first = this.entries.keys().next().value;
      if (!first) {
        break;
      }
      const removed = this.entries.get(first);
      this.entries.delete(first);
      total -= removed?.size_bytes ?? 0;
    }
  }
}

const cache = new LocalWarmCache();

function briefKey(range: BriefRange, timezone: string): string {
  return `daily_brief:${targetDate(range, timezone)}`;
}

export async function getDailyBrief(range: BriefRange = "today", opts: { force?: boolean; reason?: string } = {}): Promise<DailyBrief> {
  return withDbAsync(async (db) => {
    const user = profile(db);
    const key = briefKey(range, user.timezone || "UTC");
    const options = {
      key,
      ttlMs: DEFAULT_TTL_MS,
      reason: opts.reason ?? "brief.read",
      compute: async () => computeDailyBrief(db, range)
    };
    return opts.force
      ? DailyBriefSchema.parse(await cache.refresh(options))
      : DailyBriefSchema.parse(await cache.get(options));
  });
}

export async function getOverview(opts: { force?: boolean; reason?: string } = {}): Promise<Overview> {
  const brief = await getDailyBrief("today", opts);
  return withDbAsync(async (db) => {
    const options = {
      key: "overview",
      ttlMs: SHORT_TTL_MS,
      reason: opts.reason ?? "overview.read",
      compute: async () => {
        const user = profile(db);
        return OverviewSchema.parse({
          generated_at: nowIso(),
          profile: {
            display_name: user.display_name,
            honorific: user.honorific,
            timezone: user.timezone,
            tts_enabled: Boolean(user.tts_enabled),
            tts_voice: user.tts_voice,
            tts_rate: user.tts_rate,
            tts_pitch: user.tts_pitch
          },
          brief,
          active_workspaces: activeWorkspaces(db),
          running_sessions: runningSessions(db),
          recent_handoffs: recentHandoffs(db, 5),
          blockers: taskBlockers(db),
          cache: cache.stats()
        });
      }
    };
    return opts.force
      ? OverviewSchema.parse(await cache.refresh(options))
      : OverviewSchema.parse(await cache.get(options));
  });
}

export async function prewarmWarmCache(reason = "runtime.startup"): Promise<WarmCacheStats> {
  await ensureWardLayout();
  await cache.load();
  await getDailyBrief("today", { force: true, reason });
  await getOverview({ force: true, reason });

  await withDbAsync(async (db) => {
    const workspaces = db.query<WorkspaceRow, []>("SELECT * FROM workspace WHERE status = 'active' ORDER BY last_opened_at DESC, updated_at DESC").all();
    const lastOpened = workspaces[0];
    if (lastOpened) {
      await cache.refresh({
        key: `workspace_summary:${lastOpened.id}`,
        ttlMs: 6 * 60 * 60 * 1000,
        reason,
        compute: async () => computeWorkspaceSummary(db, lastOpened.id)
      });
      await cache.refresh({
        key: `recent_sessions:${lastOpened.id}`,
        ttlMs: SHORT_TTL_MS,
        reason,
        compute: async () => db.query<SessionRow, [number]>("SELECT * FROM session WHERE workspace_id = ? ORDER BY started_at DESC LIMIT 10").all(lastOpened.id)
      });
    }
    for (const workspace of workspaces) {
      await cache.refresh({
        key: `active_blockers:${workspace.id}`,
        ttlMs: SHORT_TTL_MS,
        reason,
        compute: async () => taskBlockers(db).filter((blocker) => blocker.workspace_id === workspace.id)
      });
    }
  });

  return cache.stats();
}

export async function warmCacheStats(): Promise<WarmCacheStats> {
  await cache.load();
  return cache.stats();
}

export function invalidateWarmCacheForEvent(eventType: string, payload: Record<string, unknown> = {}): void {
  cache.invalidate((key) => {
    if (["workspace.created", "session.completed", "session.failed", "task.created", "task.transitioned", "task.gate_opened", "wiki.page_written"].includes(eventType)) {
      if (key === "overview" || key.startsWith("daily_brief:")) {
        return true;
      }
      if (typeof payload.workspace_id === "number" && (
        key === `workspace_summary:${payload.workspace_id}` ||
        key === `active_blockers:${payload.workspace_id}` ||
        key === `recent_sessions:${payload.workspace_id}`
      )) {
        return true;
      }
    }
    return false;
  });
}

export async function getHandoff(sessionId: string): Promise<OutcomeRecord> {
  return withDb((db) => {
    const row = db.query<OutcomeRow, [string]>("SELECT * FROM outcome_record WHERE session_id = ?").get(sessionId);
    if (!row) {
      throw new Error("Handoff not found");
    }
    return outcomeFromRow(row);
  });
}

async function insertSessionEvent(db: Database, session: WardSession, eventType: "session.completed" | "session.failed", duration: number): Promise<void> {
  const event = createEvent({
    event_type: eventType,
    trace_id: createTraceId("session"),
    workspace_id: session.workspace_id,
    session_id: session.id,
    source: "runtime",
    payload: { session_id: session.id, duration_ms: duration }
  });
  db.query(`
    INSERT INTO session_event (id, session_id, event_type, trace_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(event.event_id, session.id, event.event_type, event.trace_id, JSON.stringify(event.payload), event.timestamp);
  recordSystemEvent(db, event);
}

function handoffMarkdown(input: {
  session: WardSession;
  workspaceName: string;
  taskTitle: string | null;
  outcomeSummary: string;
  keyChanges: string[];
  artifacts: string[];
  blockers: string[];
  handoff: string;
}): string {
  const lines = [
    `## ${new Date().toISOString()} - ${input.session.lifecycle_state}`,
    "",
    `Outcome: ${input.outcomeSummary}`,
    input.taskTitle ? `Task: ${input.taskTitle}` : null,
    "",
    "Key changes:",
    ...(input.keyChanges.length ? input.keyChanges.map((change) => `- ${change}`) : ["- No key changes recorded."]),
    "",
    "Artifacts:",
    ...(input.artifacts.length ? input.artifacts.map((artifact) => `- ${artifact}`) : ["- None recorded."]),
    "",
    "Blockers:",
    ...(input.blockers.length ? input.blockers.map((blocker) => `- ${blocker}`) : ["- None."]),
    "",
    `Handoff: ${input.handoff}`
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

export async function writeSessionHandoff(
  sessionId: string,
  draft: {
    key_changes?: string[];
    artifacts?: string[];
    blockers?: string[];
    architecture_touched?: boolean;
    outcome_summary?: string;
    handoff?: string;
  } = {}
): Promise<OutcomeRecord> {
  const context = withDb((db) => {
    const session = db.query<SessionRow, [string]>("SELECT * FROM session WHERE id = ?").get(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const workspace = session.workspace_id
      ? db.query<{ id: number; slug: string; name: string }, [number]>("SELECT id, slug, name FROM workspace WHERE id = ?").get(session.workspace_id)
      : null;
    if (!workspace) {
      throw new Error("Session is not attached to a workspace");
    }
    const task = session.task_id
      ? db.query<{ id: string; title: string }, [string]>("SELECT id, title FROM task WHERE id = ?").get(session.task_id)
      : null;
    return { session: sessionFromRow(session), workspace, task };
  });

  await ensureMemoryBootstrap();
  const status = context.session.lifecycle_state === "failed" ? "failed" : "completed";
  const outcomeSummary = draft.outcome_summary ?? context.session.summary ?? `${status} session in ${context.workspace.name}`;
  const keyChanges = draft.key_changes?.length ? draft.key_changes : [outcomeSummary];
  const artifacts = draft.artifacts ?? [];
  const blockers = draft.blockers ?? [];
  const handoff = draft.handoff ?? (blockers.length > 0
    ? `Resolve ${blockers[0]} before resuming.`
    : `Resume ${context.workspace.name} from this outcome.`);
  const entry = handoffMarkdown({
    session: context.session,
    workspaceName: context.workspace.name,
    taskTitle: context.task?.title ?? null,
    outcomeSummary,
    keyChanges,
    artifacts,
    blockers,
    handoff
  });

  await appendWikiPage(`workspace/${context.workspace.slug}`, "sessions.md", entry, "llm", `handoff: ${sessionId}`);
  const wikiCommit = (await wikiPageHistory(`workspace/${context.workspace.slug}`, "sessions.md"))[0]?.hash ?? null;

  if (draft.architecture_touched) {
    await appendWikiPage(
      `workspace/${context.workspace.slug}`,
      "decisions.md",
      `## ${new Date().toISOString()} - Session ${sessionId}\n\n${outcomeSummary}`,
      "llm",
      `decisions: ${sessionId}`
    );
  }

  const outcome = withDb((db) => {
    const outcomeId = id("outcome");
    const timestamp = nowIso();
    db.query(`
      INSERT INTO outcome_record (
        id, session_id, workspace_id, task_id, status, outcome_summary,
        key_changes_json, artifacts_json, blockers_json, handoff, wiki_commit, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        status = excluded.status,
        outcome_summary = excluded.outcome_summary,
        key_changes_json = excluded.key_changes_json,
        artifacts_json = excluded.artifacts_json,
        blockers_json = excluded.blockers_json,
        handoff = excluded.handoff,
        wiki_commit = excluded.wiki_commit,
        created_at = excluded.created_at
    `).run(
      outcomeId,
      sessionId,
      context.workspace.id,
      context.session.task_id,
      status,
      outcomeSummary,
      JSON.stringify(keyChanges),
      JSON.stringify(artifacts),
      JSON.stringify(blockers),
      handoff,
      wikiCommit,
      timestamp
    );
    const row = db.query<OutcomeRow, [string]>("SELECT * FROM outcome_record WHERE session_id = ?").get(sessionId)!;
    recordSystemEvent(db, createEvent({
      event_type: "agent.artifact_written",
      trace_id: createTraceId("handoff"),
      workspace_id: context.workspace.id,
      session_id: sessionId,
      source: "runtime",
      payload: { session_id: sessionId, artifact_kind: "handoff", artifact_ref: "sessions.md" }
    }));
    return outcomeFromRow(row);
  });

  invalidateWarmCacheForEvent(status === "completed" ? "session.completed" : "session.failed", { workspace_id: context.workspace.id });
  await prewarmWarmCache("session.handoff");
  return outcome;
}

export async function createSimulatedSession(input: SimulateSessionInput): Promise<{ session: WardSession; outcome: OutcomeRecord }> {
  const parsed = SimulateSessionSchema.parse(input);
  const session = await withDbAsync(async (db) => {
    const workspace = db.query<{ id: number; name: string; slug: string }, [string]>("SELECT id, name, slug FROM workspace WHERE slug = ?").get(parsed.workspace_slug);
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    if (parsed.task_id && !db.query<{ id: string }, [string]>("SELECT id FROM task WHERE id = ?").get(parsed.task_id)) {
      throw new Error("Task not found");
    }
    const sessionId = id("session");
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - parsed.duration_ms);
    const summary = parsed.summary ?? `Simulated ${parsed.status} session for ${workspace.name}.`;
    db.query(`
      INSERT INTO session (
        id, workspace_id, task_id, brain_id, runtime_kind, mode, lifecycle_state,
        summary, started_at, ended_at
      )
      VALUES (?, ?, ?, 'simulated-brain', 'simulated', 'post_session', ?, ?, ?, ?)
    `).run(
      sessionId,
      workspace.id,
      parsed.task_id ?? null,
      parsed.status,
      summary,
      startedAt.toISOString(),
      endedAt.toISOString()
    );
    const row = sessionFromRow(db.query<SessionRow, [string]>("SELECT * FROM session WHERE id = ?").get(sessionId)!);
    await insertSessionEvent(db, row, parsed.status === "completed" ? "session.completed" : "session.failed", parsed.duration_ms);
    return row;
  });

  const outcome = await writeSessionHandoff(session.id, {
    key_changes: parsed.key_changes,
    artifacts: parsed.artifacts,
    blockers: parsed.blockers,
    architecture_touched: parsed.architecture_touched
  });
  return { session, outcome };
}
