import { createHash } from "node:crypto";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  AddArtifactSchema,
  AttachmentSchema,
  CreateTaskSchema,
  CreateWorkspaceSchema,
  OpenGateSchema,
  ProfilePatchSchema,
  TaskArtifactSchema,
  TaskContractSchema,
  TaskGateSchema,
  TaskPhaseSchema,
  TaskSchema,
  TaskStatusSchema,
  TransitionTaskSchema,
  UpdateWorkspaceSchema,
  UserProfileSchema,
  WorkspaceRepoSchema,
  WorkspaceSchema,
  createEvent,
  createTraceId,
  inferAttachmentKind,
  ingestorForKind,
  nowIso,
  type AddArtifactInput,
  type CreateTaskInput,
  type CreateWorkspaceInput,
  type OpenGateInput,
  type Preference,
  type ProfilePatch,
  type TaskArtifact,
  type TaskGate,
  type TaskPhase,
  type TaskStatus,
  type TransitionTaskInput,
  type UpdateWorkspaceInput,
  type UserProfile,
  type WardAttachment,
  type WardEvent,
  type WardTask,
  type WardTaskContract,
  type Workspace,
  type WorkspaceRepo
} from "@ward/core";
import type { Database } from "bun:sqlite";
import { ensureWardLayout, resolveWardPaths, type WardPaths } from "./layout.ts";
import { openWardDatabase } from "./migrations.ts";
import { ensureMemoryBootstrap, ensureWorkspaceWiki } from "./wiki.ts";
import { invalidateWarmCacheForEvent } from "./warm.ts";

type WorkspaceRow = Omit<Workspace, "last_opened_at" | "primary_repo_path"> & {
  primary_repo_path: string | null;
  last_opened_at: string | null;
};

type WorkspaceRepoRow = Omit<WorkspaceRepo, "is_primary" | "watch_enabled"> & {
  is_primary: number;
  watch_enabled: number;
};

type ProfileRow = Omit<UserProfile, "tts_enabled"> & {
  tts_enabled: number;
};

type AttachmentRow = WardAttachment;

type TaskRow = Omit<WardTask, "external_ref_json"> & {
  external_ref_json: string | null;
};

type TaskContractRow = Omit<WardTaskContract, "constraints" | "acceptance_criteria" | "file_plan"> & {
  constraints_json: string;
  acceptance_criteria_json: string;
  file_plan_json: string;
};

type TaskGateRow = TaskGate;

type TaskArtifactRow = Omit<TaskArtifact, "redacted"> & {
  redacted: number;
};

const TERMINAL_STATUSES = new Set<TaskStatus>(["shipped", "done", "canceled"]);

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  idea: ["planned", "canceled"],
  planned: ["approved", "needs_user", "canceled"],
  approved: ["queued", "in_progress", "needs_user", "canceled"],
  queued: ["in_progress", "blocked", "canceled"],
  in_progress: ["needs_user", "needs_work", "blocked", "ready_to_ship", "done", "canceled"],
  needs_user: ["approved", "queued", "in_progress", "shipped", "done", "canceled"],
  needs_work: ["queued", "in_progress", "blocked", "canceled"],
  blocked: ["queued", "canceled"],
  ready_to_ship: ["needs_user", "shipped", "done", "canceled"],
  shipped: ["done"],
  done: [],
  canceled: []
};

const DEFAULT_PHASE_BY_STATUS: Record<TaskStatus, TaskPhase> = {
  idea: "intake",
  planned: "planning",
  approved: "approval",
  queued: "implementation",
  in_progress: "implementation",
  needs_user: "approval",
  needs_work: "implementation",
  blocked: "implementation",
  ready_to_ship: "shipping",
  shipped: "closed",
  done: "closed",
  canceled: "closed"
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

function parseJson(value: string | null): unknown | null {
  if (!value) {
    return null;
  }
  return JSON.parse(value);
}

function stringifyJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

function profileFromRow(row: ProfileRow): UserProfile {
  return UserProfileSchema.parse({
    ...row,
    tts_enabled: Boolean(row.tts_enabled)
  });
}

function workspaceFromRow(row: WorkspaceRow): Workspace {
  return WorkspaceSchema.parse(row);
}

function repoFromRow(row: WorkspaceRepoRow): WorkspaceRepo {
  return WorkspaceRepoSchema.parse({
    ...row,
    is_primary: Boolean(row.is_primary),
    watch_enabled: Boolean(row.watch_enabled)
  });
}

function attachmentFromRow(row: AttachmentRow): WardAttachment {
  return AttachmentSchema.parse(row);
}

function taskFromRow(row: TaskRow): WardTask {
  return TaskSchema.parse({
    ...row,
    external_ref_json: parseJson(row.external_ref_json)
  });
}

function contractFromRow(row: TaskContractRow): WardTaskContract {
  return TaskContractSchema.parse({
    id: row.id,
    task_id: row.task_id,
    goal: row.goal,
    constraints: JSON.parse(row.constraints_json),
    acceptance_criteria: JSON.parse(row.acceptance_criteria_json),
    file_plan: JSON.parse(row.file_plan_json),
    reporting_format: row.reporting_format,
    max_iterations: row.max_iterations,
    created_at: row.created_at
  });
}

function gateFromRow(row: TaskGateRow): TaskGate {
  return TaskGateSchema.parse(row);
}

function artifactFromRow(row: TaskArtifactRow): TaskArtifact {
  return TaskArtifactSchema.parse({
    ...row,
    redacted: Boolean(row.redacted)
  });
}

function recordSystemEvent(db: Database, event: WardEvent): void {
  db.query(`
    INSERT INTO system_event (id, event_type, trace_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(event.event_id, event.event_type, event.trace_id, JSON.stringify(event.payload), event.timestamp);
}

function taskEvent(db: Database, event_type: string, task_id: string, payload: Record<string, unknown>): void {
  recordSystemEvent(db, createEvent({
    event_type,
    trace_id: createTraceId("task"),
    workspace_id: null,
    session_id: null,
    source: "runtime",
    payload: { task_id, ...payload }
  }));
}

export function ensureDefaultProfile(): UserProfile {
  return withDb((db) => {
    const existing = db.query<ProfileRow, []>("SELECT * FROM user_profile WHERE id = 'self'").get();
    if (existing) {
      return profileFromRow(existing);
    }

    const timestamp = nowIso();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    db.query(`
      INSERT INTO user_profile (
        id, display_name, honorific, timezone, work_hours_start, work_hours_end,
        quiet_hours_start, quiet_hours_end, persona_tone, tts_enabled, tts_voice,
        tts_rate, tts_pitch, presence_default, created_at, updated_at
      )
      VALUES ('self', '', NULL, ?, '09:00', '17:00', '22:00', '07:00',
        'casual', 0, NULL, 1, 1, 'present', ?, ?)
    `).run(timezone, timestamp, timestamp);

    return profileFromRow(db.query<ProfileRow, []>("SELECT * FROM user_profile WHERE id = 'self'").get()!);
  });
}

export function getProfile(): UserProfile {
  return ensureDefaultProfile();
}

export function updateProfile(input: ProfilePatch): UserProfile {
  const patch = ProfilePatchSchema.parse(input);
  return withDb((db) => {
    if (!db.query<ProfileRow, []>("SELECT * FROM user_profile WHERE id = 'self'").get()) {
      const timestamp = nowIso();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      db.query(`
        INSERT INTO user_profile (
          id, display_name, honorific, timezone, work_hours_start, work_hours_end,
          quiet_hours_start, quiet_hours_end, persona_tone, tts_enabled, tts_voice,
          tts_rate, tts_pitch, presence_default, created_at, updated_at
        )
        VALUES ('self', '', NULL, ?, '09:00', '17:00', '22:00', '07:00',
          'casual', 0, NULL, 1, 1, 'present', ?, ?)
      `).run(timezone, timestamp, timestamp);
    }

    const allowed = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (allowed.length === 0) {
      return profileFromRow(db.query<ProfileRow, []>("SELECT * FROM user_profile WHERE id = 'self'").get()!);
    }

    const assignments = allowed.map(([key]) => `${key} = ?`).join(", ");
    const values = allowed.map(([, value]) => typeof value === "boolean" ? Number(value) : value);
    db.query(`UPDATE user_profile SET ${assignments}, updated_at = ? WHERE id = 'self'`)
      .run(...values, nowIso());
    return profileFromRow(db.query<ProfileRow, []>("SELECT * FROM user_profile WHERE id = 'self'").get()!);
  });
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workspace";
}

function uniqueSlug(db: Database, name: string): string {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  while (db.query<{ id: number }, [string]>("SELECT id FROM workspace WHERE slug = ?").get(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const data = CreateWorkspaceSchema.parse(input);
  return withDbAsync(async (db, paths) => {
    await ensureWardLayout(paths);
    await ensureMemoryBootstrap(paths);
    const timestamp = nowIso();
    const slug = uniqueSlug(db, data.name);
    db.query(`
      INSERT INTO workspace (name, slug, description, status, primary_repo_path, autonomy_level, last_opened_at, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `).run(data.name, slug, data.description, data.repo ?? null, data.autonomy_level, timestamp, timestamp, timestamp);
    const row = db.query<WorkspaceRow, [string]>("SELECT * FROM workspace WHERE slug = ?").get(slug)!;
    const workspace = workspaceFromRow(row);
    await mkdir(join(paths.workspacesDir, slug), { recursive: true, mode: 0o700 });

    if (data.repo) {
      db.query(`
        INSERT INTO workspace_repo (workspace_id, local_path, branch, is_primary, watch_enabled)
        VALUES (?, ?, NULL, 1, 1)
      `).run(workspace.id, resolve(data.repo));
    }

    await ensureWorkspaceWiki(workspace, paths, db);

    recordSystemEvent(db, createEvent({
      event_type: "workspace.created",
      trace_id: createTraceId("workspace"),
      workspace_id: workspace.id,
      session_id: null,
      source: "runtime",
      payload: { workspace_id: workspace.id, slug: workspace.slug, name: workspace.name }
    }));
    invalidateWarmCacheForEvent("workspace.created", { workspace_id: workspace.id });

    return workspace;
  });
}

export function listWorkspaces(): Workspace[] {
  return withDb((db) => db.query<WorkspaceRow, []>("SELECT * FROM workspace ORDER BY last_opened_at DESC, created_at DESC")
    .all()
    .map(workspaceFromRow));
}

export function getWorkspaceById(id: number): Workspace | null {
  return withDb((db) => {
    const row = db.query<WorkspaceRow, [number]>("SELECT * FROM workspace WHERE id = ?").get(id);
    return row ? workspaceFromRow(row) : null;
  });
}

export function getWorkspaceBySlug(slug: string): Workspace | null {
  return withDb((db) => {
    const row = db.query<WorkspaceRow, [string]>("SELECT * FROM workspace WHERE slug = ?").get(slug);
    return row ? workspaceFromRow(row) : null;
  });
}

export function getWorkspaceByIdOrSlug(value: string): Workspace | null {
  const numeric = Number(value);
  if (Number.isInteger(numeric)) {
    return getWorkspaceById(numeric);
  }
  return getWorkspaceBySlug(value);
}

export function updateWorkspace(id: number, input: UpdateWorkspaceInput): Workspace {
  const patch = UpdateWorkspaceSchema.parse(input);
  return withDb((db) => {
    const workspace = db.query<WorkspaceRow, [number]>("SELECT * FROM workspace WHERE id = ?").get(id);
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (entries.length > 0) {
      const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
      db.query(`UPDATE workspace SET ${assignments}, updated_at = ? WHERE id = ?`)
        .run(...entries.map(([, value]) => value), nowIso(), id);
    }
    return workspaceFromRow(db.query<WorkspaceRow, [number]>("SELECT * FROM workspace WHERE id = ?").get(id)!);
  });
}

export function getWorkspaceDetail(idOrSlug: string): { workspace: Workspace; repos: WorkspaceRepo[]; attachments: WardAttachment[]; tasks: WardTask[] } {
  return withDb((db) => {
    const workspace = Number.isInteger(Number(idOrSlug))
      ? db.query<WorkspaceRow, [number]>("SELECT * FROM workspace WHERE id = ?").get(Number(idOrSlug))
      : db.query<WorkspaceRow, [string]>("SELECT * FROM workspace WHERE slug = ?").get(idOrSlug);
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    const parsed = workspaceFromRow(workspace);
    db.query("UPDATE workspace SET last_opened_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), parsed.id);
    return {
      workspace: parsed,
      repos: db.query<WorkspaceRepoRow, [number]>("SELECT * FROM workspace_repo WHERE workspace_id = ? ORDER BY is_primary DESC, id ASC").all(parsed.id).map(repoFromRow),
      attachments: db.query<AttachmentRow, [number]>("SELECT * FROM attachment WHERE workspace_id = ? ORDER BY created_at DESC").all(parsed.id).map(attachmentFromRow),
      tasks: db.query<TaskRow, [number]>("SELECT * FROM task WHERE workspace_id = ? ORDER BY created_at DESC").all(parsed.id).map(taskFromRow)
    };
  });
}

export async function ingestAttachmentFromPath(workspaceIdOrSlug: string, sourcePath: string): Promise<WardAttachment> {
  const absolute = resolve(sourcePath);
  const file = Bun.file(absolute);
  if (!(await file.exists())) {
    throw new Error(`Attachment not found: ${sourcePath}`);
  }
  const kind = inferAttachmentKind(absolute, file.type);
  return ingestAttachmentBuffer(workspaceIdOrSlug, {
    name: basename(absolute),
    bytes: await file.arrayBuffer(),
    kind,
    sourcePath: absolute
  });
}

export async function ingestAttachmentBuffer(
  workspaceIdOrSlug: string,
  input: { name: string; bytes: ArrayBuffer; kind?: "markdown" | "text" | "pdf"; mimeType?: string; sourcePath?: string | null }
): Promise<WardAttachment> {
  const workspace = getWorkspaceByIdOrSlug(workspaceIdOrSlug);
  if (!workspace) {
    throw new Error("Workspace not found");
  }
  const kind = input.kind ?? inferAttachmentKind(input.name, input.mimeType);
  const ingestor = ingestorForKind(kind);

  return withDbAsync(async (db, paths) => {
    await ensureWardLayout(paths);
    const attachmentId = id("att");
    const safeName = basename(input.name).replace(/[^\w.\- ]+/g, "_");
    const dir = join(paths.attachmentsDir, workspace.slug, attachmentId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const storagePath = join(dir, safeName);
    const textPath = join(dir, "extracted.txt");
    await writeFile(storagePath, Buffer.from(input.bytes));
    const extracted = await ingestor.extractText(storagePath);
    await writeFile(textPath, extracted.text, "utf8");
    const size = (await stat(storagePath)).size;
    const timestamp = nowIso();

    db.query(`
      INSERT INTO attachment (id, workspace_id, name, source_path, storage_path, text_path, kind, bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(attachmentId, workspace.id, safeName, input.sourcePath ?? null, storagePath, textPath, kind, size, timestamp);

    const row = db.query<AttachmentRow, [string]>("SELECT * FROM attachment WHERE id = ?").get(attachmentId)!;
    return attachmentFromRow(row);
  });
}

export function listTasks(filters: { workspace?: string } = {}): WardTask[] {
  return withDb((db) => {
    if (filters.workspace) {
      const workspace = getWorkspaceByIdOrSlug(filters.workspace);
      if (!workspace) {
        throw new Error("Workspace not found");
      }
      return db.query<TaskRow, [number]>("SELECT * FROM task WHERE workspace_id = ? ORDER BY created_at DESC")
        .all(workspace.id)
        .map(taskFromRow);
    }
    return db.query<TaskRow, []>("SELECT * FROM task ORDER BY created_at DESC").all().map(taskFromRow);
  });
}

export function getTask(id: string): { task: WardTask; contract: WardTaskContract | null; gates: TaskGate[]; artifacts: TaskArtifact[] } {
  return withDb((db) => {
    const row = db.query<TaskRow, [string]>("SELECT * FROM task WHERE id = ?").get(id);
    if (!row) {
      throw new Error("Task not found");
    }
    const contract = db.query<TaskContractRow, [string]>("SELECT * FROM task_contract WHERE task_id = ? ORDER BY created_at DESC LIMIT 1").get(id);
    return {
      task: taskFromRow(row),
      contract: contract ? contractFromRow(contract) : null,
      gates: db.query<TaskGateRow, [string]>("SELECT * FROM task_gate WHERE task_id = ? ORDER BY created_at DESC").all(id).map(gateFromRow),
      artifacts: db.query<TaskArtifactRow, [string]>("SELECT * FROM task_artifact WHERE task_id = ? ORDER BY created_at DESC").all(id).map(artifactFromRow)
    };
  });
}

export function createTask(input: CreateTaskInput): WardTask {
  const parsed = CreateTaskSchema.parse(input);
  return withDb((db) => {
    const workspace = parsed.workspace_id
      ? db.query<WorkspaceRow, [number]>("SELECT * FROM workspace WHERE id = ?").get(parsed.workspace_id)
      : parsed.workspace_slug
        ? db.query<WorkspaceRow, [string]>("SELECT * FROM workspace WHERE slug = ?").get(parsed.workspace_slug)
        : null;
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    const workspaceModel = workspaceFromRow(workspace);
    const taskId = id("task");
    const timestamp = nowIso();
    const autonomy = parsed.autonomy_level ?? workspaceModel.autonomy_level;
    db.query(`
      INSERT INTO task (
        id, workspace_id, title, description, status, lifecycle_phase, type, priority,
        source, owner, autonomy_level, task_doc_path, evidence_packet_path, assignee_kind,
        plan_packet_id, parent_task_id, external_ref_json, completed_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'idea', 'intake', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      taskId,
      workspaceModel.id,
      parsed.title,
      parsed.description,
      parsed.type,
      parsed.priority,
      parsed.source,
      parsed.owner,
      autonomy,
      parsed.task_doc_path ?? null,
      parsed.evidence_packet_path ?? null,
      parsed.assignee_kind ?? null,
      parsed.plan_packet_id ?? null,
      parsed.parent_task_id ?? null,
      stringifyJson(parsed.external_ref_json),
      timestamp,
      timestamp
    );

    if (parsed.contract) {
      db.query(`
        INSERT INTO task_contract (
          id, task_id, goal, constraints_json, acceptance_criteria_json,
          file_plan_json, reporting_format, max_iterations, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id("contract"),
        taskId,
        parsed.contract.goal,
        JSON.stringify(parsed.contract.constraints),
        JSON.stringify(parsed.contract.acceptance_criteria),
        JSON.stringify(parsed.contract.file_plan),
        parsed.contract.reporting_format,
        parsed.contract.max_iterations,
        timestamp
      );
    }

    taskEvent(db, "task.created", taskId, { source: parsed.source, title: parsed.title });
    invalidateWarmCacheForEvent("task.created", { workspace_id: workspaceModel.id, task_id: taskId });
    return taskFromRow(db.query<TaskRow, [string]>("SELECT * FROM task WHERE id = ?").get(taskId)!);
  });
}

function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (!TERMINAL_STATUSES.has(from) && to === "canceled") {
    return true;
  }
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transitionTask(taskId: string, input: TransitionTaskInput): WardTask {
  const parsed = TransitionTaskSchema.parse(input);
  return withDb((db) => {
    const current = db.query<TaskRow, [string]>("SELECT * FROM task WHERE id = ?").get(taskId);
    if (!current) {
      throw new Error("Task not found");
    }
    const task = taskFromRow(current);
    if (!canTransition(task.status, parsed.status)) {
      taskEvent(db, "task.transition_rejected", taskId, {
        from_status: task.status,
        requested_status: parsed.status,
        reason: `Illegal transition ${task.status} -> ${parsed.status}`
      });
      throw new Error(`Illegal task transition: ${task.status} -> ${parsed.status}`);
    }

    const nextPhase = parsed.phase ?? DEFAULT_PHASE_BY_STATUS[parsed.status];
    const completedAt = TERMINAL_STATUSES.has(parsed.status) ? nowIso() : null;
    db.query(`
      UPDATE task
      SET status = ?, lifecycle_phase = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(parsed.status, nextPhase, completedAt, nowIso(), taskId);
    taskEvent(db, "task.transitioned", taskId, {
      from_status: task.status,
      to_status: parsed.status,
      from_phase: task.lifecycle_phase,
      to_phase: nextPhase,
      reason: parsed.reason
    });
    invalidateWarmCacheForEvent("task.transitioned", { workspace_id: task.workspace_id, task_id: taskId });
    return taskFromRow(db.query<TaskRow, [string]>("SELECT * FROM task WHERE id = ?").get(taskId)!);
  });
}

export function openTaskGate(taskId: string, input: OpenGateInput): TaskGate {
  const parsed = OpenGateSchema.parse(input);
  return withDb((db) => {
    const task = db.query<TaskRow, [string]>("SELECT * FROM task WHERE id = ?").get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    const gateId = id("gate");
    const timestamp = nowIso();
    db.query(`
      INSERT INTO task_gate (id, task_id, gate_type, reason, requested_by, status, created_at, resolved_at, resolution_note)
      VALUES (?, ?, ?, ?, ?, 'open', ?, NULL, NULL)
    `).run(gateId, taskId, parsed.gate_type, parsed.reason, parsed.requested_by, timestamp);
    taskEvent(db, "task.gate_opened", taskId, { gate_id: gateId, gate_type: parsed.gate_type, reason: parsed.reason });
    invalidateWarmCacheForEvent("task.gate_opened", { workspace_id: task.workspace_id, task_id: taskId });

    const current = taskFromRow(task);
    if (current.status !== "blocked" && current.status !== "needs_user" && !TERMINAL_STATUSES.has(current.status)) {
      db.query("UPDATE task SET status = 'needs_user', updated_at = ? WHERE id = ?").run(timestamp, taskId);
      taskEvent(db, "task.transitioned", taskId, {
        from_status: current.status,
        to_status: "needs_user",
        from_phase: current.lifecycle_phase,
        to_phase: current.lifecycle_phase,
        reason: `Approval gate opened: ${parsed.gate_type}`
      });
    }

    return gateFromRow(db.query<TaskGateRow, [string]>("SELECT * FROM task_gate WHERE id = ?").get(gateId)!);
  });
}

export function resolveTaskGate(taskId: string, decision: "approved" | "rejected", input: { gate_id?: string; note?: string } = {}): TaskGate {
  return withDb((db) => {
    const task = db.query<TaskRow, [string]>("SELECT * FROM task WHERE id = ?").get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    const gate = input.gate_id
      ? db.query<TaskGateRow, [string, string]>("SELECT * FROM task_gate WHERE id = ? AND task_id = ?").get(input.gate_id, taskId)
      : db.query<TaskGateRow, [string]>("SELECT * FROM task_gate WHERE task_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").get(taskId);
    if (!gate) {
      throw new Error("Open gate not found");
    }
    const timestamp = nowIso();
    db.query("UPDATE task_gate SET status = ?, resolved_at = ?, resolution_note = ? WHERE id = ?")
      .run(decision, timestamp, input.note ?? null, gate.id);
    taskEvent(db, "task.gate_resolved", taskId, { gate_id: gate.id, decision });

    const current = taskFromRow(task);
    if (current.status === "needs_user") {
      const nextStatus: TaskStatus = decision === "approved"
        ? gate.gate_type === "planning_scope" ? "approved" : "in_progress"
        : "canceled";
      db.query("UPDATE task SET status = ?, lifecycle_phase = ?, completed_at = ?, updated_at = ? WHERE id = ?")
        .run(nextStatus, DEFAULT_PHASE_BY_STATUS[nextStatus], TERMINAL_STATUSES.has(nextStatus) ? timestamp : null, timestamp, taskId);
      taskEvent(db, "task.transitioned", taskId, {
        from_status: current.status,
        to_status: nextStatus,
        from_phase: current.lifecycle_phase,
        to_phase: DEFAULT_PHASE_BY_STATUS[nextStatus],
        reason: `Gate ${decision}: ${gate.gate_type}`
      });
    }

    return gateFromRow(db.query<TaskGateRow, [string]>("SELECT * FROM task_gate WHERE id = ?").get(gate.id)!);
  });
}

export function addTaskArtifact(taskId: string, input: AddArtifactInput): TaskArtifact {
  const parsed = AddArtifactSchema.parse(input);
  return withDb((db) => {
    const task = db.query<TaskRow, [string]>("SELECT * FROM task WHERE id = ?").get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    const artifactId = id("artifact");
    const checksum = parsed.checksum ?? (parsed.path ? checksumPath(parsed.path) : null);
    db.query(`
      INSERT INTO task_artifact (id, task_id, artifact_kind, path, url, checksum, redacted, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(artifactId, taskId, parsed.artifact_kind, parsed.path ?? null, parsed.url ?? null, checksum, Number(parsed.redacted), nowIso());
    taskEvent(db, "task.evidence_attached", taskId, {
      artifact_ref: parsed.path ?? parsed.url,
      evidence_kind: parsed.artifact_kind
    });
    return artifactFromRow(db.query<TaskArtifactRow, [string]>("SELECT * FROM task_artifact WHERE id = ?").get(artifactId)!);
  });
}

function checksumPath(path: string): string | null {
  try {
    const file = Bun.file(path);
    const bytes = Bun.spawnSync(["shasum", "-a", "256", path]);
    if (bytes.exitCode === 0) {
      return bytes.stdout.toString().split(/\s+/, 1)[0] ?? null;
    }
    if (file.size === 0) {
      return createHash("sha256").update("").digest("hex");
    }
  } catch {
    // Missing paths can still be recorded as references.
  }
  return null;
}

export function getTaskEvents(taskId: string): WardEvent[] {
  return withDb((db) => db.query<{ id: string; event_type: string; trace_id: string; payload_json: string; created_at: string }, [string]>(
    "SELECT * FROM system_event WHERE payload_json LIKE ? ORDER BY created_at ASC"
  ).all(`%"task_id":"${taskId}"%`).map((row) => ({
    event_id: row.id,
    event_type: row.event_type,
    trace_id: row.trace_id,
    timestamp: row.created_at,
    workspace_id: null,
    session_id: null,
    source: "runtime",
    payload: JSON.parse(row.payload_json),
    version: 1
  })));
}

export function getTaskEvidence(taskId: string): { artifacts: TaskArtifact[] } {
  return {
    artifacts: getTask(taskId).artifacts
  };
}

export function listPreferences(): Preference[] {
  return withDb((db) => db.query<{
    id: number;
    scope: "global" | "workspace" | "repo";
    workspace_id: number | null;
    key: string;
    value_json: string;
    source: "user" | "inferred" | "system";
    confidence: number;
    updated_at: string;
  }, []>("SELECT * FROM preference ORDER BY scope, key").all().map((row) => ({
    ...row,
    value_json: JSON.parse(row.value_json)
  })));
}

export function setPreference(scope: "global" | "workspace" | "repo", key: string, value: unknown, workspaceId?: number): Preference {
  return withDb((db) => {
    const timestamp = nowIso();
    db.query(`
      INSERT INTO preference (scope, workspace_id, key, value_json, source, confidence, updated_at)
      VALUES (?, ?, ?, ?, 'user', 1, ?)
      ON CONFLICT(scope, workspace_id, key) DO UPDATE SET
        value_json = excluded.value_json,
        source = 'user',
        confidence = 1,
        updated_at = excluded.updated_at
    `).run(scope, workspaceId ?? null, key, JSON.stringify(value), timestamp);
    const row = db.query<{
      id: number;
      scope: "global" | "workspace" | "repo";
      workspace_id: number | null;
      key: string;
      value_json: string;
      source: "user" | "inferred" | "system";
      confidence: number;
      updated_at: string;
    }, [string, number | null, string]>("SELECT * FROM preference WHERE scope = ? AND workspace_id IS ? AND key = ?")
      .get(scope, workspaceId ?? null, key)!;
    return { ...row, value_json: JSON.parse(row.value_json) };
  });
}

export async function copyArtifactToTask(taskId: string, sourcePath: string, kind = "file"): Promise<TaskArtifact> {
  const task = getTask(taskId).task;
  const workspace = getWorkspaceById(task.workspace_id);
  if (!workspace) {
    throw new Error("Workspace not found");
  }
  const paths = resolveWardPaths();
  await ensureWardLayout(paths);
  const artifactId = id("artifact");
  const artifactDir = join(paths.workspacesDir, workspace.slug, "artifacts", taskId);
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  const destination = join(artifactDir, basename(sourcePath));
  await copyFile(resolve(sourcePath), destination);
  return addTaskArtifact(taskId, { artifact_kind: kind, path: destination });
}
