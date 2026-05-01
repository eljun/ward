import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ContextPacketSchema,
  HarnessLaunchSchema,
  HarnessSessionDetailSchema,
  HarnessSessionPathsSchema,
  HarnessSessionSchema,
  HarnessTaskContractSchema,
  LaunchSessionSchema,
  SessionListFiltersSchema,
  TaskContractSchema,
  WardEventSchema,
  createEvent,
  createTraceId,
  nowIso,
  type ContextPacket,
  type HarnessLaunch,
  type HarnessLifecycleState,
  type HarnessSession,
  type HarnessSessionDetail,
  type HarnessSessionPaths,
  type HarnessTaskContract,
  type LaunchSessionInput,
  type SessionListFilters,
  type WardEvent
} from "@ward/core";
import type { Database } from "bun:sqlite";
import { ensureWardLayout, resolveWardPaths, type WardPaths } from "./layout.ts";
import { openWardDatabase } from "./migrations.ts";
import { ensureMemoryBootstrap } from "./wiki.ts";

type WorkspaceRow = {
  id: number;
  name: string;
  slug: string;
  description: string;
  autonomy_level: "strict" | "standard" | "lenient";
  primary_repo_path: string | null;
};

type WorkspaceRepoRow = {
  local_path: string;
};

type TaskRow = {
  id: string;
  workspace_id: number;
  title: string;
  description: string;
  autonomy_level: "strict" | "standard" | "lenient";
  task_doc_path: string | null;
  evidence_packet_path: string | null;
  plan_packet_id: string | null;
};

type TaskContractRow = {
  goal: string;
  constraints_json: string;
  acceptance_criteria_json: string;
  reporting_format: "pr" | "release_note" | "handoff" | "none";
  max_iterations: number;
};

type SessionRow = {
  id: string;
  workspace_id: number | null;
  workspace_slug: string | null;
  task_id: string | null;
  task_title: string | null;
  brain_id: string | null;
  runtime_kind: string | null;
  mode: string | null;
  lifecycle_state: string | null;
  queue_state: string | null;
  working_dir: string | null;
  summary: string | null;
  incognito: number;
  worker_pid: number | null;
  trace_id: string | null;
  scenario: string | null;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
};

type SessionEventRow = {
  id: string;
  event_type: string;
  trace_id: string;
  payload_json: string;
  created_at: string;
};

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

function sessionPaths(paths: WardPaths, sessionId: string): HarnessSessionPaths {
  return HarnessSessionPathsSchema.parse({
    session_dir: join(paths.sessionsDir, sessionId),
    task_contract_path: join(paths.sessionsDir, sessionId, "task-contract.json"),
    context_packet_path: join(paths.sessionsDir, sessionId, "context-packet.json"),
    mcp_overlay_path: join(paths.sessionsDir, sessionId, "mcp-overlay.json"),
    events_path: join(paths.sessionsDir, sessionId, "events.ndjson"),
    artifacts_dir: join(paths.sessionsDir, sessionId, "artifacts"),
    summary_path: join(paths.sessionsDir, sessionId, "summary.md"),
    pty_raw_path: join(paths.sessionsDir, sessionId, "pty.raw")
  });
}

function sessionFromRow(row: SessionRow): HarnessSession {
  return HarnessSessionSchema.parse({
    id: row.id,
    workspace_id: row.workspace_id,
    workspace_slug: row.workspace_slug,
    task_id: row.task_id,
    task_title: row.task_title,
    brain_id: row.brain_id,
    runtime_kind: row.runtime_kind,
    mode: row.mode,
    lifecycle_state: row.lifecycle_state,
    queue_state: row.queue_state,
    working_dir: row.working_dir,
    summary: row.summary,
    incognito: Boolean(row.incognito),
    worker_pid: row.worker_pid,
    trace_id: row.trace_id,
    scenario: row.scenario,
    started_at: row.started_at,
    ended_at: row.ended_at,
    updated_at: row.updated_at
  });
}

function parseStoredEvent(row: SessionEventRow, session: HarnessSession): WardEvent {
  const parsed = JSON.parse(row.payload_json);
  if (parsed && typeof parsed === "object" && "event_id" in parsed && "source" in parsed) {
    return WardEventSchema.parse(parsed);
  }
  return WardEventSchema.parse({
    event_id: row.id,
    event_type: row.event_type,
    trace_id: row.trace_id,
    timestamp: row.created_at,
    workspace_id: session.workspace_id,
    session_id: session.id,
    source: "runtime",
    payload: parsed,
    version: 1
  });
}

function workspaceBySlug(db: Database, slug: string): WorkspaceRow {
  const workspace = db.query<WorkspaceRow, [string]>(`
    SELECT id, name, slug, description, autonomy_level, primary_repo_path
    FROM workspace
    WHERE slug = ?
  `).get(slug);
  if (!workspace) {
    throw new Error("Workspace not found");
  }
  return workspace;
}

function taskById(db: Database, taskId: string): TaskRow {
  const task = db.query<TaskRow, [string]>(`
    SELECT id, workspace_id, title, description, autonomy_level, task_doc_path, evidence_packet_path, plan_packet_id
    FROM task
    WHERE id = ?
  `).get(taskId);
  if (!task) {
    throw new Error("Task not found");
  }
  return task;
}

function buildTaskContract(
  task: TaskRow | null,
  contractRow: TaskContractRow | null,
  input: ReturnType<typeof LaunchSessionSchema.parse>
): HarnessTaskContract {
  const goal = input.goal?.trim()
    || contractRow?.goal
    || task?.description.trim()
    || task?.title
    || "Execute the requested WARD harness session.";
  const acceptance = input.acceptance_criteria.length > 0
    ? input.acceptance_criteria.map((statement, index) => ({
        id: `AC${index + 1}`,
        statement,
        verification: "test" as const,
        required: true
      }))
    : contractRow
      ? JSON.parse(contractRow.acceptance_criteria_json)
      : [];
  return HarnessTaskContractSchema.parse({
    task_id: task?.id ?? input.task_id ?? null,
    goal,
    constraints: input.constraints.length > 0
      ? input.constraints
      : contractRow
        ? JSON.parse(contractRow.constraints_json)
        : ["Stay inside the linked workspace and emit durable artifacts."],
    acceptance_criteria: acceptance,
    source_docs: input.source_docs,
    reporting_format: "stream-json",
    max_iterations: contractRow?.max_iterations ?? 3
  });
}

function buildContextPacket(db: Database, workspace: WorkspaceRow, task: TaskRow | null, traceId: string): ContextPacket {
  const recentSessions = db.query<{ summary: string | null }, [number]>(`
    SELECT summary
    FROM session
    WHERE workspace_id = ?
      AND summary IS NOT NULL
      AND trim(summary) != ''
    ORDER BY started_at DESC
    LIMIT 3
  `).all(workspace.id).flatMap((row) => row.summary ? [row.summary] : []);
  const activeBlockers = db.query<{ title: string }, [number]>(`
    SELECT title
    FROM task
    WHERE workspace_id = ?
      AND status IN ('blocked', 'needs_user', 'needs_work')
    ORDER BY updated_at DESC
    LIMIT 5
  `).all(workspace.id).map((row) => row.title);
  const repoSnapshot = db.query<{ snapshot_path: string }, [number]>(`
    SELECT snapshot_path
    FROM repo_snapshot
    WHERE workspace_id = ?
    ORDER BY refreshed_at DESC
    LIMIT 1
  `).get(workspace.id);
  const durableArtifactRefs = [
    task?.task_doc_path ? { kind: "task_doc", path: task.task_doc_path, excerpt: task.title } : null,
    task?.evidence_packet_path ? { kind: "evidence_packet", path: task.evidence_packet_path, excerpt: task.title } : null
  ].filter((value): value is { kind: string; path: string; excerpt: string } => Boolean(value));

  return ContextPacketSchema.parse({
    workspace_summary: workspace.description.trim() || `${workspace.name} workspace.`,
    recent_sessions: recentSessions,
    relevant_wiki_refs: [],
    durable_artifact_refs: durableArtifactRefs,
    active_blockers: activeBlockers,
    repo_snapshot_ref: repoSnapshot?.snapshot_path ?? "",
    preferences_excerpt: {},
    trace_id: traceId
  });
}

async function ensureSessionFiles(paths: HarnessSessionPaths, launch: HarnessLaunch): Promise<void> {
  await mkdir(paths.session_dir, { recursive: true, mode: 0o700 });
  await mkdir(paths.artifacts_dir, { recursive: true, mode: 0o700 });
  await writeFile(paths.task_contract_path, JSON.stringify(launch.task_contract, null, 2), "utf8");
  await writeFile(paths.context_packet_path, JSON.stringify(launch.context_packet, null, 2), "utf8");
  await writeFile(paths.mcp_overlay_path, JSON.stringify({
    allowed_tools: launch.allowed_tools,
    autonomy_level: launch.autonomy_level,
    incognito: launch.incognito,
    timeouts: launch.timeouts,
    generated_at: launch.created_at
  }, null, 2), "utf8");
  await writeFile(paths.events_path, "", "utf8");
}

async function readLaunchFromFiles(session: HarnessSession, paths: HarnessSessionPaths): Promise<HarnessLaunch> {
  const [taskContractRaw, contextPacketRaw, mcpOverlayRaw] = await Promise.all([
    readFile(paths.task_contract_path, "utf8"),
    readFile(paths.context_packet_path, "utf8"),
    readFile(paths.mcp_overlay_path, "utf8")
  ]);
  const taskContract = HarnessTaskContractSchema.parse(JSON.parse(taskContractRaw));
  const contextPacket = ContextPacketSchema.parse(JSON.parse(contextPacketRaw));
  const overlay = JSON.parse(mcpOverlayRaw) as {
    allowed_tools?: string[];
    autonomy_level?: HarnessLaunch["autonomy_level"];
    incognito?: boolean;
    timeouts?: HarnessLaunch["timeouts"];
  };
  return HarnessLaunchSchema.parse({
    session_id: session.id,
    workspace_id: session.workspace_id,
    task_id: session.task_id,
    brain_id: session.brain_id ?? "stub-worker",
    runtime_kind: session.runtime_kind ?? "local",
    mode: session.mode ?? "headless",
    working_dir: session.working_dir ?? "",
    task_contract: taskContract,
    context_packet: contextPacket,
    allowed_tools: overlay.allowed_tools ?? ["ward.status"],
    mcp_overlay_path: paths.mcp_overlay_path,
    timeouts: overlay.timeouts ?? {
      wall_clock_max_ms: 120000,
      idle_max_ms: 30000
    },
    autonomy_level: overlay.autonomy_level ?? "standard",
    incognito: overlay.incognito ?? session.incognito,
    created_at: session.started_at,
    scenario: session.scenario ?? "default"
  });
}

function sessionRowQuery(): string {
  return `
    SELECT
      session.id,
      session.workspace_id,
      workspace.slug AS workspace_slug,
      session.task_id,
      task.title AS task_title,
      session.brain_id,
      session.runtime_kind,
      session.mode,
      session.lifecycle_state,
      session.queue_state,
      session.working_dir,
      session.summary,
      session.incognito,
      session.worker_pid,
      session.trace_id,
      session.scenario,
      session.started_at,
      session.ended_at,
      session.updated_at
    FROM session
    LEFT JOIN workspace ON workspace.id = session.workspace_id
    LEFT JOIN task ON task.id = session.task_id
  `;
}

function harnessSessionClause(): string {
  return "session.trace_id IS NOT NULL AND session.scenario IS NOT NULL AND session.working_dir IS NOT NULL";
}

export async function prepareHarnessLaunch(input: LaunchSessionInput): Promise<{ session: HarnessSession; launch: HarnessLaunch; paths: HarnessSessionPaths }> {
  const parsed = LaunchSessionSchema.parse(input);
  return withDbAsync(async (db, paths) => {
    await ensureWardLayout(paths);
    await ensureMemoryBootstrap(paths);

    const workspace = workspaceBySlug(db, parsed.workspace_slug);
    const task = parsed.task_id ? taskById(db, parsed.task_id) : null;
    if (task && task.workspace_id !== workspace.id) {
      throw new Error("Task does not belong to the selected workspace");
    }
    const taskContractRow = task
      ? db.query<TaskContractRow, [string]>(`
          SELECT goal, constraints_json, acceptance_criteria_json, reporting_format, max_iterations
          FROM task_contract
          WHERE task_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `).get(task.id) ?? null
      : null;
    const workingDir = db.query<WorkspaceRepoRow, [number]>(`
      SELECT local_path
      FROM workspace_repo
      WHERE workspace_id = ?
      ORDER BY is_primary DESC, id ASC
      LIMIT 1
    `).get(workspace.id)?.local_path ?? workspace.primary_repo_path ?? join(paths.workspacesDir, workspace.slug);
    const traceId = createTraceId("session");
    const sessionId = id("session");
    const createdAt = nowIso();
    const contract = buildTaskContract(task, taskContractRow, parsed);
    const context = buildContextPacket(db, workspace, task, traceId);
    const launch = HarnessLaunchSchema.parse({
      session_id: sessionId,
      workspace_id: workspace.id,
      task_id: task?.id ?? null,
      brain_id: parsed.brain_id,
      runtime_kind: parsed.runtime_kind,
      mode: parsed.mode,
      working_dir: workingDir,
      task_contract: contract,
      context_packet: context,
      allowed_tools: parsed.allowed_tools,
      mcp_overlay_path: sessionPaths(paths, sessionId).mcp_overlay_path,
      timeouts: {
        wall_clock_max_ms: parsed.wall_clock_max_ms,
        idle_max_ms: parsed.idle_max_ms
      },
      autonomy_level: parsed.autonomy_level ?? task?.autonomy_level ?? workspace.autonomy_level,
      incognito: parsed.incognito,
      created_at: createdAt,
      scenario: parsed.scenario
    });
    const filePaths = sessionPaths(paths, sessionId);
    await ensureSessionFiles(filePaths, launch);

    db.query(`
      INSERT INTO session (
        id, workspace_id, task_id, brain_id, runtime_kind, mode, lifecycle_state,
        queue_state, working_dir, summary, incognito, worker_pid, trace_id, scenario,
        started_at, ended_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, NULL, ?, ?, ?, NULL, ?)
    `).run(
      sessionId,
      workspace.id,
      task?.id ?? null,
      parsed.brain_id,
      parsed.runtime_kind,
      parsed.mode,
      workingDir,
      parsed.incognito ? 1 : 0,
      traceId,
      parsed.scenario,
      createdAt,
      createdAt
    );

    const session = getHarnessSession(sessionId);
    await appendHarnessEvent(session.id, createEvent({
      event_type: "session.created",
      trace_id: traceId,
      workspace_id: workspace.id,
      session_id: session.id,
      source: "runtime",
      payload: {
        brain_id: parsed.brain_id,
        runtime_kind: parsed.runtime_kind,
        mode: parsed.mode,
        scenario: parsed.scenario
      }
    }));
    await transitionHarnessSession(session.id, "queued", "Session created and awaiting launch.");
    return { session: getHarnessSession(sessionId), launch, paths: filePaths };
  });
}

export function listHarnessSessions(filters: Partial<SessionListFilters> = {}): HarnessSession[] {
  const parsed = SessionListFiltersSchema.parse(filters);
  return withDb((db) => {
    const clauses: string[] = [harnessSessionClause()];
    const params: Array<string | number> = [];
    if (parsed.workspace) {
      clauses.push("(workspace.slug = ? OR CAST(workspace.id AS TEXT) = ?)");
      params.push(parsed.workspace, parsed.workspace);
    }
    if (parsed.state) {
      clauses.push("session.lifecycle_state = ?");
      params.push(parsed.state);
    }
    if (!parsed.include_incognito) {
      clauses.push("COALESCE(session.incognito, 0) = 0");
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return db.query<SessionRow, Array<string | number>>(`${sessionRowQuery()} ${where} ORDER BY session.started_at DESC`).all(...params)
      .map(sessionFromRow);
  });
}

export function getHarnessSession(sessionId: string): HarnessSession {
  return withDb((db) => {
    const row = db.query<SessionRow, [string]>(`
      ${sessionRowQuery()}
      WHERE session.id = ?
        AND ${harnessSessionClause()}
    `).get(sessionId);
    if (!row) {
      throw new Error("Harness session not found");
    }
    return sessionFromRow(row);
  });
}

export async function getHarnessSessionDetail(sessionId: string): Promise<HarnessSessionDetail> {
  const session = getHarnessSession(sessionId);
  const paths = sessionPaths(resolveWardPaths(), session.id);
  const launch = await readLaunchFromFiles(session, paths);
  const events = withDb((db) => db.query<SessionEventRow, [string]>(`
    SELECT id, event_type, trace_id, payload_json, created_at
    FROM session_event
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(sessionId).map((row) => parseStoredEvent(row, session)));
  const artifacts = await readdir(paths.artifacts_dir).catch(() => []);
  return HarnessSessionDetailSchema.parse({
    session,
    launch,
    paths,
    events,
    artifacts: artifacts.map((name) => join(paths.artifacts_dir, name))
  });
}

export async function appendHarnessEvent(sessionId: string, event: WardEvent): Promise<void> {
  const session = getHarnessSession(sessionId);
  const paths = sessionPaths(resolveWardPaths(), sessionId);
  await appendFile(paths.events_path, `${JSON.stringify(event)}\n`, "utf8");
  withDb((db) => {
    db.query(`
      INSERT INTO session_event (id, session_id, event_type, trace_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(event.event_id, sessionId, event.event_type, event.trace_id, JSON.stringify(event), event.timestamp);
    db.query("UPDATE session SET updated_at = ? WHERE id = ?").run(event.timestamp, sessionId);
  });
}

export async function transitionHarnessSession(sessionId: string, nextState: HarnessLifecycleState, detail?: string): Promise<HarnessSession> {
  const session = getHarnessSession(sessionId);
  if (session.lifecycle_state === nextState) {
    return session;
  }
  const timestamp = nowIso();
  withDb((db) => {
    db.query(`
      UPDATE session
      SET lifecycle_state = ?, ended_at = CASE
        WHEN ? IN ('done', 'failed', 'blocked', 'canceled') THEN COALESCE(ended_at, ?)
        ELSE NULL
      END, updated_at = ?
      WHERE id = ?
    `).run(nextState, nextState, timestamp, timestamp, sessionId);
  });
  await appendHarnessEvent(sessionId, createEvent({
    event_type: "session.state_changed",
    trace_id: session.trace_id ?? createTraceId("session"),
    workspace_id: session.workspace_id,
    session_id: sessionId,
    source: "runtime",
    payload: {
      from_state: session.lifecycle_state,
      to_state: nextState,
      detail: detail ?? null
    }
  }));
  return getHarnessSession(sessionId);
}

export function setHarnessWorkerPid(sessionId: string, workerPid: number | null): HarnessSession {
  withDb((db) => {
    db.query("UPDATE session SET worker_pid = ?, updated_at = ? WHERE id = ?").run(workerPid, nowIso(), sessionId);
  });
  return getHarnessSession(sessionId);
}

export async function finalizeHarnessSession(sessionId: string, nextState: Extract<HarnessLifecycleState, "done" | "failed" | "blocked" | "canceled">, summary: string): Promise<HarnessSession> {
  const current = getHarnessSession(sessionId);
  if (current.lifecycle_state !== nextState) {
    await transitionHarnessSession(sessionId, nextState, summary);
  }
  const paths = sessionPaths(resolveWardPaths(), sessionId);
  await writeFile(paths.summary_path, summary, "utf8");
  withDb((db) => {
    db.query("UPDATE session SET summary = ?, ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE id = ?")
      .run(summary, nowIso(), nowIso(), sessionId);
  });
  return getHarnessSession(sessionId);
}

export async function recoverInterruptedHarnessSessions(): Promise<HarnessSession[]> {
  const recoverableStates: HarnessLifecycleState[] = [
    "initializing",
    "implementing",
    "testing",
    "creating_artifacts",
    "awaiting_approval"
  ];
  const staleSessions = withDb((db) => {
    const placeholders = recoverableStates.map(() => "?").join(", ");
    return db.query<SessionRow, string[]>(`
      ${sessionRowQuery()}
      WHERE session.lifecycle_state IN (${placeholders})
        AND ${harnessSessionClause()}
    `).all(...recoverableStates).map(sessionFromRow);
  });

  const recovered: HarnessSession[] = [];
  for (const session of staleSessions) {
    await transitionHarnessSession(
      session.id,
      "blocked",
      "Runtime restarted before this stub harness could be reattached."
    );
    setHarnessWorkerPid(session.id, null);
    recovered.push(getHarnessSession(session.id));
  }
  return recovered;
}
