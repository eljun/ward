import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AnswerPlanSchema,
  PlanPacketSchema,
  PlanRoundTranscriptSchema,
  PlanSessionSchema,
  RevisePlanSchema,
  StartPlanSchema,
  createEvent,
  createTraceId,
  nowIso,
  type AnswerPlanInput,
  type ConvergencePolicy,
  type PlanDetail,
  type PlanPacket,
  type PlanRoundName,
  type PlanRoundOutput,
  type PlanRoundTranscript,
  type PlanSession,
  type PlanTaskEntry,
  type RevisePlanInput,
  type StartPlanInput,
  type WardEvent,
  type WardTask
} from "@ward/core";
import type { Database } from "bun:sqlite";
import { ensureWardLayout, resolveWardPaths, type WardPaths } from "./layout.ts";
import { openWardDatabase } from "./migrations.ts";
import { createTask } from "./repositories.ts";
import { refreshAllRepoSnapshots, refreshChangedRepoSnapshots, refreshWorkspaceSnapshots, listRepoSnapshots } from "./code-context.ts";
import { deleteWikiPages, ensureMemoryBootstrap, listWikiPages, rebuildSearchIndex, writeWikiPage } from "./wiki.ts";

type WorkspaceRow = {
  id: number;
  name: string;
  slug: string;
  description: string;
  autonomy_level: string;
};

type AttachmentRow = {
  id: string;
  name: string;
  text_path: string;
  kind: string;
};

type PlanSessionRow = Omit<PlanSession, "workspace_slug" | "clarifying_questions" | "user_answers"> & {
  workspace_slug: string;
  clarifying_questions_json: string;
  user_answers_json: string;
};

type PlanPacketRow = {
  id: string;
  workspace_id: number;
  plan_session_id: string;
  version: number;
  status: string;
  packet_json: string;
  supersedes: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

type PlanRoundRow = Omit<PlanRoundTranscript, "participants_json"> & {
  participants_json: string;
};

type PlanSessionCandidateRow = Pick<
  PlanSessionRow,
  "id" | "workspace_id" | "workspace_slug" | "status" | "prompt" | "convergence_policy" | "user_answers_json" | "updated_at"
> & {
  packet_id: string | null;
  packet_status: string | null;
};

type WaitingPlanCandidateRow = Pick<
  PlanSessionRow,
  "id" | "user_answers_json" | "updated_at"
> & {
  packet_id: string | null;
};

const ROUNDS: PlanRoundName[] = ["context", "proposal", "critique", "convergence", "decision"];
const PARTICIPANTS = [
  { brain_id: "sim_requirements", role: "requirements_lead" },
  { brain_id: "sim_implementation", role: "implementation_lead" },
  { brain_id: "sim_challenger", role: "challenger" }
];

const DUPLICATE_REUSE_WINDOW_MS = 30_000;

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

function sessionFromRow(row: PlanSessionRow): PlanSession {
  return PlanSessionSchema.parse({
    ...row,
    clarifying_questions: JSON.parse(row.clarifying_questions_json),
    user_answers: JSON.parse(row.user_answers_json)
  });
}

function packetFromRow(row: PlanPacketRow): PlanPacket {
  return PlanPacketSchema.parse(JSON.parse(row.packet_json));
}

function roundFromRow(row: PlanRoundRow): PlanRoundTranscript {
  return PlanRoundTranscriptSchema.parse({
    ...row,
    participants_json: JSON.parse(row.participants_json)
  });
}

function recordSystemEvent(db: Database, event: WardEvent): void {
  db.query(`
    INSERT INTO system_event (id, event_type, trace_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(event.event_id, event.event_type, event.trace_id, JSON.stringify(event.payload), event.timestamp);
}

function workspaceByIdOrSlug(db: Database, value: string): WorkspaceRow {
  const workspace = Number.isInteger(Number(value))
    ? db.query<WorkspaceRow, [number]>("SELECT * FROM workspace WHERE id = ?").get(Number(value))
    : db.query<WorkspaceRow, [string]>("SELECT * FROM workspace WHERE slug = ?").get(value);
  if (!workspace) {
    throw new Error("Workspace not found");
  }
  return workspace;
}

function updatedRecently(timestamp: string, windowMs = DUPLICATE_REUSE_WINDOW_MS): boolean {
  const updatedAt = Date.parse(timestamp);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= windowMs;
}

function duplicateWaitingKey(plan: PlanDetail): string | null {
  if (plan.session.status !== "waiting_for_user" || plan.packet || plan.session.user_answers.length > 0) {
    return null;
  }
  return [
    plan.session.workspace_slug,
    plan.session.prompt,
    plan.session.clarifying_questions.join("|")
  ].join("::");
}

function dedupePlans(plans: PlanDetail[]): PlanDetail[] {
  const seenWaiting = new Set<string>();
  return plans.filter((plan) => {
    const key = duplicateWaitingKey(plan);
    if (!key) {
      return true;
    }
    if (seenWaiting.has(key)) {
      return false;
    }
    seenWaiting.add(key);
    return true;
  });
}

async function attachmentExcerpts(db: Database, workspaceId: number): Promise<Array<{ name: string; excerpt: string }>> {
  const rows = db.query<AttachmentRow, [number]>("SELECT id, name, text_path, kind FROM attachment WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 5")
    .all(workspaceId);
  const excerpts: Array<{ name: string; excerpt: string }> = [];
  for (const row of rows) {
    const file = Bun.file(row.text_path);
    if (await file.exists()) {
      const text = await file.text();
      excerpts.push({ name: row.name, excerpt: text.slice(0, 600) });
    }
  }
  return excerpts;
}

function planSessionDir(paths: WardPaths, sessionId: string): string {
  return join(paths.sessionsDir, sessionId, "rounds");
}

async function writeTranscriptFile(paths: WardPaths, sessionId: string, roundIndex: number, roundName: PlanRoundName, payload: unknown): Promise<string> {
  const dir = planSessionDir(paths, sessionId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${roundIndex}-${roundName}.json`);
  await writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

function updateSessionRound(db: Database, sessionId: string, round: PlanRoundName, status?: string): void {
  db.query("UPDATE plan_session SET current_round = ?, status = COALESCE(?, status), updated_at = ? WHERE id = ?")
    .run(round, status ?? null, nowIso(), sessionId);
}

function insertTranscript(
  db: Database,
  transcript: Omit<PlanRoundTranscript, "participants_json"> & { participants_json: PlanRoundOutput[] }
): void {
  db.query(`
    INSERT INTO plan_round_transcript (
      id, plan_session_id, plan_packet_id, round_index, round_name, moderator_summary,
      participants_json, file_path, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(plan_session_id, round_index) DO UPDATE SET
      plan_packet_id = excluded.plan_packet_id,
      moderator_summary = excluded.moderator_summary,
      participants_json = excluded.participants_json,
      file_path = excluded.file_path,
      created_at = excluded.created_at
  `).run(
    transcript.id,
    transcript.plan_session_id,
    transcript.plan_packet_id,
    transcript.round_index,
    transcript.round_name,
    transcript.moderator_summary,
    JSON.stringify(transcript.participants_json),
    transcript.file_path,
    transcript.created_at
  );
}

function simulatedOutputs(round: PlanRoundName, prompt: string, forceClarification: boolean): PlanRoundOutput[] {
  if (round === "context") {
    return PARTICIPANTS.map((participant, index) => ({
      round,
      participant_id: participant.brain_id,
      acknowledged: true,
      clarifying_questions: forceClarification && index === 0 ? ["What outcome should be optimized first: speed, safety, or scope?"] : [],
      missing_context: []
    }));
  }

  if (round === "proposal") {
    return PARTICIPANTS.map((participant) => ({
      round,
      participant_id: participant.brain_id,
      approach_name: participant.role === "challenger" ? "Risk-first plan" : participant.role === "implementation_lead" ? "Incremental build plan" : "Contract-first plan",
      summary: `${participant.role} proposes a deterministic, local-first approach for ${prompt}.`,
      architecture_sketch: "Use Runtime APIs, SQLite persistence, wiki hard-memory, and a small UI surface.",
      sequence: ["Capture contract", "Implement storage", "Expose CLI/API", "Verify through smoke flow"],
      risks: ["Scope creep", "Missing acceptance evidence"],
      effort_estimate: "medium",
      assumptions: ["Simulated participants are acceptable for this phase"]
    }));
  }

  if (round === "critique") {
    return PARTICIPANTS.map((participant) => ({
      round,
      participant_id: participant.brain_id,
      reviews: PARTICIPANTS
        .filter((target) => target.brain_id !== participant.brain_id)
        .map((target) => ({
          target_participant_id: target.brain_id,
          strengths: ["Fits existing WARD layers"],
          weaknesses: ["Needs explicit verification artifacts"],
          questions: ["How will generated tasks remain traceable?"]
        }))
    }));
  }

  return PARTICIPANTS.map((participant) => ({
    round: "convergence",
    participant_id: participant.brain_id,
    ranking: ["A", "B"],
    top_pick_rationale: "Candidate A keeps the implementation local-first and evidence-driven.",
    remaining_concerns: participant.role === "challenger" ? ["Watch for over-broad task generation"] : []
  }));
}

function moderatorSummary(round: PlanRoundName, outputs: PlanRoundOutput[], prompt: string): string {
  if (round === "context") {
    const questions = outputs.flatMap((output) => output.round === "context" ? output.clarifying_questions : []);
    return questions.length > 0
      ? `Context acknowledged for "${prompt}", with ${questions.length} clarifying question.`
      : `Context acknowledged for "${prompt}" by all simulated participants.`;
  }
  if (round === "proposal") {
    return "Participants proposed contract-first, incremental, and risk-first approaches.";
  }
  if (round === "critique") {
    return "Critique converged on traceability, verification evidence, and scoped task generation.";
  }
  if (round === "convergence") {
    return "Participants ranked the incremental local-first candidate highest.";
  }
  return "Moderator produced the draft Plan Packet.";
}

function priorityToTaskPriority(priority: PlanTaskEntry["priority"]): "high" | "medium" | "low" {
  return priority === "normal" ? "medium" : priority;
}

function buildPacket(input: {
  packetId: string;
  workspace: WorkspaceRow;
  sessionId: string;
  prompt: string;
  version: number;
  status: "draft" | "approved" | "superseded" | "aborted";
  transcripts: string[];
  attachments: Array<{ name: string; excerpt: string }>;
  repoSnapshotRef: string | null;
  convergencePolicy: ConvergencePolicy;
  supersedes?: string;
  revisionNotes?: string;
}): PlanPacket {
  const timestamp = nowIso();
  const title = `Plan: ${input.prompt.slice(0, 72) || input.workspace.name}`;
  const revisionSuffix = input.revisionNotes ? ` Revision note: ${input.revisionNotes}` : "";
  return PlanPacketSchema.parse({
    packet_id: input.packetId,
    workspace_id: input.workspace.id,
    version: input.version,
    status: input.status,
    title,
    summary: `A simulated multi-participant plan for ${input.workspace.name}: ${input.prompt}.${revisionSuffix}`,
    goals: [
      "Produce a durable task contract",
      "Keep implementation local-first and verifiable",
      "Preserve evidence through wiki, sessions, and SQLite"
    ],
    non_goals: [
      "Call paid external model APIs in Task 006",
      "Publish to external PM tools without an MCP configuration"
    ],
    constraints: [
      "Use Bun + TypeScript runtime patterns",
      "Persist state before exposing UI claims",
      "Generate tasks only after user approval"
    ],
    assumptions: [
      "Simulated participants stand in for real Plan Mode brains",
      "Linked repo snapshot is sufficient for first-pass code context"
    ],
    risks: [
      { risk: "Generated tasks may be too broad", likelihood: "med", mitigation: "Keep generated task count small and acceptance criteria concrete." },
      { risk: "Code snapshot may miss dynamic project details", likelihood: "low", mitigation: "Expose snapshot refresh and store snapshot refs." }
    ],
    open_questions: [],
    architecture: {
      overview: "Plan Mode stores a session, round transcripts, a validated Plan Packet, and optional generated tasks linked back to the packet.",
      components: [
        { name: "Plan Engine", purpose: "Runs deterministic simulated rounds and validates outputs." },
        { name: "Code-Context Service", purpose: "Builds repo snapshots for planning context." },
        { name: "Task Generator", purpose: "Converts approved packet tasks into WARD task contracts." }
      ],
      data_flow: "Workspace state, attachments, wiki pages, and repo snapshots feed simulated participants; moderator emits a Plan Packet; approval renders wiki; generate-tasks writes task rows."
    },
    phases: [
      {
        name: "Foundation",
        goal: "Persist and validate the plan.",
        deliverables: ["Plan Packet", "Round transcripts", "Repo snapshot"],
        dependencies: []
      },
      {
        name: "Execution",
        goal: "Turn the approved packet into executable tasks.",
        deliverables: ["Task rows", "Task contracts", "Task docs"],
        dependencies: ["Foundation"]
      }
    ],
    tasks: [
      {
        title: `Implement ${input.workspace.name} foundation`,
        description: "Build the storage, API, and CLI surface described by the approved plan.",
        acceptance_criteria: ["Plan-backed task exists", "Build passes", "Smoke commands are documented"],
        assignee_hint: "codex",
        phase: "Foundation",
        priority: "high"
      },
      {
        title: `Verify ${input.workspace.name} flow`,
        description: "Run the end-to-end smoke flow and capture evidence.",
        acceptance_criteria: ["Smoke flow passes", "Evidence is attached", "Docs list verification commands"],
        assignee_hint: "either",
        phase: "Execution",
        priority: "normal"
      }
    ],
    first_recommended_action: "Review and approve the Plan Packet, then generate tasks.",
    source: {
      participants: PARTICIPANTS,
      round_transcripts: input.transcripts,
      attachments_considered: input.attachments.map((attachment) => attachment.name),
      repo_snapshot_ref: input.repoSnapshotRef,
      convergence_policy: input.convergencePolicy
    },
    supersedes: input.supersedes,
    created_at: timestamp,
    updated_at: timestamp
  });
}

function renderPlanMarkdown(packet: PlanPacket): string {
  return [
    `# ${packet.title}`,
    "",
    `Status: ${packet.status}`,
    `Version: ${packet.version}`,
    "",
    "## Summary",
    packet.summary,
    "",
    "## Goals",
    ...packet.goals.map((goal) => `- ${goal}`),
    "",
    "## Architecture",
    packet.architecture.overview,
    "",
    "## Phases",
    ...packet.phases.map((phase) => `### ${phase.name}\n\n${phase.goal}\n\nDeliverables:\n${phase.deliverables.map((item) => `- ${item}`).join("\n")}`),
    "",
    "## Tasks",
    ...packet.tasks.map((task) => `### ${task.title}\n\n${task.description}\n\nAcceptance:\n${task.acceptance_criteria.map((item) => `- ${item}`).join("\n")}`),
    "",
    "## Risks",
    ...packet.risks.map((risk) => `- ${risk.risk} (${risk.likelihood}): ${risk.mitigation}`),
    "",
    "## Source",
    `Participants: ${packet.source.participants.map((participant) => `${participant.brain_id}/${participant.role}`).join(", ")}`,
    `Transcripts: ${packet.source.round_transcripts.join(", ")}`,
    packet.source.repo_snapshot_ref ? `Repo snapshot: ${packet.source.repo_snapshot_ref}` : "Repo snapshot: none"
  ].join("\n");
}

function hardMemoryTaskDoc(task: WardTask, packet: PlanPacket, entry: PlanTaskEntry): string {
  return [
    `# ${entry.title}`,
    "",
    "## WARD Metadata",
    `- Task ID: ${task.id}`,
    `- Plan Packet: ${packet.packet_id}`,
    `- Workspace ID: ${packet.workspace_id}`,
    `- Phase: ${entry.phase}`,
    "",
    "## Goal",
    entry.description,
    "",
    "## Acceptance Criteria",
    ...entry.acceptance_criteria.map((criterion) => `- ${criterion}`),
    "",
    "## Agent Signals",
    "- Pending assignment.",
    "",
    "## Implementation Claims",
    "- Pending implementation.",
    "",
    "## QA Evidence",
    "- Pending verification.",
    "",
    "## Harness Critique",
    "- Pending harness review.",
    "",
    "## Open Risks",
    ...packet.risks.map((risk) => `- ${risk.risk}: ${risk.mitigation}`)
  ].join("\n");
}

function upsertPacket(db: Database, sessionId: string, packet: PlanPacket): void {
  db.query(`
    INSERT INTO plan_packet (
      id, workspace_id, plan_session_id, version, status, packet_json,
      supersedes, approved_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      version = excluded.version,
      status = excluded.status,
      packet_json = excluded.packet_json,
      supersedes = excluded.supersedes,
      approved_at = excluded.approved_at,
      updated_at = excluded.updated_at
  `).run(
    packet.packet_id,
    packet.workspace_id,
    sessionId,
    packet.version,
    packet.status,
    JSON.stringify(packet),
    packet.supersedes ?? null,
    packet.approved_at ?? null,
    packet.created_at,
    packet.updated_at
  );
  db.query("UPDATE plan_session SET packet_id = ?, status = ?, current_round = 'decision', updated_at = ? WHERE id = ?")
    .run(packet.packet_id, packet.status, packet.updated_at, sessionId);
  db.query("UPDATE session SET lifecycle_state = ?, summary = ?, ended_at = ? WHERE id = ?")
    .run(packet.status, packet.summary, packet.status === "draft" || packet.status === "waiting_for_user" ? null : packet.updated_at, sessionId);
}

async function runRound(
  db: Database,
  paths: WardPaths,
  sessionId: string,
  roundIndex: number,
  roundName: PlanRoundName,
  prompt: string,
  forceClarification: boolean,
  packetId: string | null
): Promise<PlanRoundTranscript> {
  const outputs = roundName === "decision" ? [] : simulatedOutputs(roundName, prompt, forceClarification);
  const payload = {
    round_index: roundIndex,
    round_name: roundName,
    moderator_summary: moderatorSummary(roundName, outputs, prompt),
    participants: outputs
  };
  const filePath = await writeTranscriptFile(paths, sessionId, roundIndex, roundName, payload);
  const transcript = PlanRoundTranscriptSchema.parse({
    id: id("round"),
    plan_session_id: sessionId,
    plan_packet_id: packetId,
    round_index: roundIndex,
    round_name: roundName,
    moderator_summary: payload.moderator_summary,
    participants_json: outputs,
    file_path: filePath,
    created_at: nowIso()
  });
  insertTranscript(db, transcript);
  updateSessionRound(db, sessionId, roundName);
  return transcript;
}

async function completePlanSession(db: Database, paths: WardPaths, session: PlanSession, revisionNotes?: string): Promise<PlanDetail> {
  const workspace = workspaceByIdOrSlug(db, String(session.workspace_id));
  const attachments = await attachmentExcerpts(db, workspace.id);
  const snapshots = await refreshWorkspaceSnapshots(workspace.slug).catch(() => listRepoSnapshots(workspace.slug));
  const repoSnapshot = snapshots[0] ?? null;
  const transcripts: PlanRoundTranscript[] = [];
  for (const [index, roundName] of ROUNDS.entries()) {
    transcripts.push(await runRound(db, paths, session.id, index + 1, roundName, session.prompt, false, session.packet_id));
  }

  const packetId = session.packet_id ?? id("packet");
  const packet = buildPacket({
    packetId,
    workspace,
    sessionId: session.id,
    prompt: session.prompt,
    version: 1,
    status: "draft",
    transcripts: transcripts.map((transcript) => transcript.file_path),
    attachments,
    repoSnapshotRef: repoSnapshot?.snapshot_path ?? null,
    convergencePolicy: session.convergence_policy,
    revisionNotes
  });
  upsertPacket(db, session.id, packet);
  db.query("UPDATE plan_round_transcript SET plan_packet_id = ? WHERE plan_session_id = ?").run(packet.packet_id, session.id);
  recordSystemEvent(db, createEvent({
    event_type: "plan.decision",
    trace_id: createTraceId("plan"),
    workspace_id: workspace.id,
    session_id: session.id,
    source: "runtime",
    payload: { packet_id: packet.packet_id, status: packet.status }
  }));
  return getPlanDetail(packet.packet_id);
}

export async function startPlanMode(workspaceRef: string, input: StartPlanInput = {}): Promise<PlanDetail> {
  const parsed = StartPlanSchema.parse(input);
  return withDbAsync(async (db, paths) => {
    await ensureWardLayout(paths);
    await ensureMemoryBootstrap(paths);
    const workspace = workspaceByIdOrSlug(db, workspaceRef);
    const prompt = parsed.prompt ?? `Plan next implementation steps for ${workspace.name}`;
    const policy = parsed.convergence_policy ?? "consensus";
    const forceClarification = parsed.force_clarification ?? false;

    if (forceClarification) {
      const waiting = db.query<WaitingPlanCandidateRow, [number, string]>(`
        SELECT
          id,
          user_answers_json,
          packet_id,
          updated_at
        FROM plan_session
        WHERE workspace_id = ?
          AND prompt = ?
          AND status = 'waiting_for_user'
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(workspace.id, prompt);

      if (waiting && updatedRecently(waiting.updated_at)) {
        const userAnswers = JSON.parse(waiting.user_answers_json) as string[];
        if (waiting.packet_id === null && userAnswers.length === 0) {
          return getPlanDetail(waiting.id);
        }
      }
    }

    const existing = db.query<PlanSessionCandidateRow, [number, string, string]>(`
      SELECT
        plan_session.id,
        plan_session.workspace_id,
        workspace.slug AS workspace_slug,
        plan_session.status,
        plan_session.prompt,
        plan_session.convergence_policy,
        plan_session.user_answers_json,
        plan_session.packet_id,
        plan_packet.status AS packet_status,
        plan_session.updated_at
      FROM plan_session
      JOIN workspace ON workspace.id = plan_session.workspace_id
      LEFT JOIN plan_packet ON plan_packet.id = plan_session.packet_id
      WHERE plan_session.workspace_id = ?
        AND plan_session.prompt = ?
        AND plan_session.convergence_policy = ?
        AND plan_session.status IN ('draft', 'waiting_for_user')
      ORDER BY plan_session.updated_at DESC
      LIMIT 1
    `).get(workspace.id, prompt, policy);

    if (existing && updatedRecently(existing.updated_at)) {
      const userAnswers = JSON.parse(existing.user_answers_json) as string[];
      const reuseDraft = !forceClarification
        && existing.status === "draft"
        && existing.packet_id !== null
        && existing.packet_status === "draft";
      if (reuseDraft) {
        return getPlanDetail(existing.id);
      }
    }

    const sessionId = id("plan");
    const timestamp = nowIso();

    db.query(`
      INSERT INTO plan_session (
        id, workspace_id, status, current_round, prompt, convergence_policy,
        clarifying_questions_json, user_answers_json, packet_id, created_at, updated_at
      )
      VALUES (?, ?, 'draft', 'context', ?, ?, '[]', '[]', NULL, ?, ?)
    `).run(sessionId, workspace.id, prompt, policy, timestamp, timestamp);
    db.query(`
      INSERT INTO session (
        id, workspace_id, task_id, brain_id, runtime_kind, mode, lifecycle_state,
        summary, started_at, ended_at
      )
      VALUES (?, ?, NULL, 'simulated-plan', 'simulated', 'plan_mode', 'draft', ?, ?, NULL)
    `).run(sessionId, workspace.id, `Plan Mode for ${workspace.name}`, timestamp);

    const contextTranscript = await runRound(db, paths, sessionId, 1, "context", prompt, forceClarification, null);
    const questions = contextTranscript.participants_json.flatMap((output) => output.round === "context" ? output.clarifying_questions : []);
    if (questions.length > 0) {
      db.query("UPDATE plan_session SET status = 'waiting_for_user', clarifying_questions_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(questions), nowIso(), sessionId);
      return getPlanDetail(sessionId);
    }

    const session = sessionFromRow(db.query<PlanSessionRow, [string]>(`
      SELECT plan_session.*, workspace.slug AS workspace_slug
      FROM plan_session
      JOIN workspace ON workspace.id = plan_session.workspace_id
      WHERE plan_session.id = ?
    `).get(sessionId)!);
    return completePlanSession(db, paths, session);
  });
}

export function getPlanDetail(planIdOrSessionId: string): PlanDetail {
  return withDb((db) => {
    let sessionRow = db.query<PlanSessionRow, [string, string]>(`
      SELECT plan_session.*, workspace.slug AS workspace_slug
      FROM plan_session
      JOIN workspace ON workspace.id = plan_session.workspace_id
      WHERE plan_session.id = ? OR plan_session.packet_id = ?
    `).get(planIdOrSessionId, planIdOrSessionId);
    let packetRow: PlanPacketRow | null = null;

    if (!sessionRow) {
      packetRow = db.query<PlanPacketRow, [string]>("SELECT * FROM plan_packet WHERE id = ?").get(planIdOrSessionId) ?? null;
      if (packetRow) {
        sessionRow = db.query<PlanSessionRow, [string]>(`
          SELECT plan_session.*, workspace.slug AS workspace_slug
          FROM plan_session
          JOIN workspace ON workspace.id = plan_session.workspace_id
          WHERE plan_session.id = ?
        `).get(packetRow.plan_session_id);
      }
    }

    if (!sessionRow) {
      throw new Error("Plan not found");
    }
    const session = sessionFromRow(sessionRow);
    packetRow ??= session.packet_id
      ? db.query<PlanPacketRow, [string]>("SELECT * FROM plan_packet WHERE id = ?").get(session.packet_id) ?? null
      : null;
    const rounds = db.query<PlanRoundRow, [string]>("SELECT * FROM plan_round_transcript WHERE plan_session_id = ? ORDER BY round_index ASC")
      .all(session.id)
      .map(roundFromRow);
    return { session, packet: packetRow ? packetFromRow(packetRow) : null, rounds };
  });
}

export async function answerPlan(planIdOrSessionId: string, input: AnswerPlanInput): Promise<PlanDetail> {
  const parsed = AnswerPlanSchema.parse(input);
  return withDbAsync(async (db, paths) => {
    const detail = getPlanDetail(planIdOrSessionId);
    const answers = [...detail.session.user_answers, ...parsed.answers, ...(parsed.answer ? [parsed.answer] : [])];
    db.query("UPDATE plan_session SET user_answers_json = ?, clarifying_questions_json = '[]', status = 'draft', updated_at = ? WHERE id = ?")
      .run(JSON.stringify(answers), nowIso(), detail.session.id);
    const next = sessionFromRow(db.query<PlanSessionRow, [string]>(`
      SELECT plan_session.*, workspace.slug AS workspace_slug
      FROM plan_session
      JOIN workspace ON workspace.id = plan_session.workspace_id
      WHERE plan_session.id = ?
    `).get(detail.session.id)!);
    return completePlanSession(db, paths, next);
  });
}

export async function approvePlan(planIdOrSessionId: string): Promise<PlanDetail> {
  const detail = getPlanDetail(planIdOrSessionId);
  if (!detail.packet) {
    throw new Error("Plan packet is not ready for approval");
  }
  const approved = PlanPacketSchema.parse({
    ...detail.packet,
    status: "approved",
    approved_at: nowIso(),
    approved_by: "user",
    updated_at: nowIso()
  });
  await writeWikiPage(`workspace/${detail.session.workspace_slug}`, `plans/${approved.packet_id}.md`, renderPlanMarkdown(approved), "llm", `plan: approve ${approved.packet_id}`);
  return withDb((db) => {
    upsertPacket(db, detail.session.id, approved);
    recordSystemEvent(db, createEvent({
      event_type: "plan.approved",
      trace_id: createTraceId("plan"),
      workspace_id: approved.workspace_id,
      session_id: detail.session.id,
      source: "user",
      payload: { packet_id: approved.packet_id }
    }));
    return getPlanDetail(approved.packet_id);
  });
}

export async function revisePlan(planIdOrSessionId: string, input: RevisePlanInput): Promise<PlanDetail> {
  const parsed = RevisePlanSchema.parse(input);
  return withDbAsync(async (db, paths) => {
    const detail = getPlanDetail(planIdOrSessionId);
    if (!detail.packet) {
      throw new Error("Plan packet is not ready for revision");
    }
    const timestamp = nowIso();
    const superseded = PlanPacketSchema.parse({ ...detail.packet, status: "superseded", updated_at: timestamp });
    db.query("UPDATE plan_packet SET status = 'superseded', packet_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(superseded), timestamp, detail.packet.packet_id);
    const workspace = workspaceByIdOrSlug(db, String(detail.packet.workspace_id));
    const packetId = id("packet");
    const packet = buildPacket({
      packetId,
      workspace,
      sessionId: detail.session.id,
      prompt: detail.session.prompt,
      version: detail.packet.version + 1,
      status: "draft",
      transcripts: detail.rounds.map((round) => round.file_path),
      attachments: [],
      repoSnapshotRef: detail.packet.source.repo_snapshot_ref ?? null,
      convergencePolicy: detail.session.convergence_policy,
      supersedes: detail.packet.packet_id,
      revisionNotes: parsed.notes
    });
    upsertPacket(db, detail.session.id, packet);
    return getPlanDetail(packet.packet_id);
  });
}

export function abortPlan(planIdOrSessionId: string): PlanDetail {
  return withDb((db) => {
    const detail = getPlanDetail(planIdOrSessionId);
    const timestamp = nowIso();
    db.query("UPDATE plan_session SET status = 'aborted', updated_at = ? WHERE id = ?").run(timestamp, detail.session.id);
    db.query("UPDATE session SET lifecycle_state = 'aborted', ended_at = ? WHERE id = ?").run(timestamp, detail.session.id);
    if (detail.packet) {
      const aborted = PlanPacketSchema.parse({ ...detail.packet, status: "aborted", updated_at: timestamp });
      upsertPacket(db, detail.session.id, aborted);
    }
    return getPlanDetail(detail.session.id);
  });
}

export function listPlans(workspaceRef?: string): PlanDetail[] {
  return withDb((db) => {
    const rows = workspaceRef
      ? db.query<{ id: string }, [string, string]>(`
          SELECT plan_session.id
          FROM plan_session
          JOIN workspace ON workspace.id = plan_session.workspace_id
          WHERE workspace.slug = ? OR CAST(workspace.id AS TEXT) = ?
          ORDER BY plan_session.updated_at DESC
        `).all(workspaceRef, workspaceRef)
      : db.query<{ id: string }, []>("SELECT id FROM plan_session ORDER BY updated_at DESC").all();
    return dedupePlans(rows.map((row) => getPlanDetail(row.id)));
  });
}

export async function clearWorkspacePlans(workspaceRef: string): Promise<{
  workspace_id: number;
  workspace_slug: string;
  cleared_sessions: number;
  cleared_packets: number;
  cleared_rounds: number;
  detached_tasks: number;
  cleared_pages: number;
}> {
  const paths = resolveWardPaths();
  await ensureWardLayout(paths);
  await ensureMemoryBootstrap(paths);

  const summary = withDb((db) => {
    const workspace = workspaceByIdOrSlug(db, workspaceRef);
    const sessionIds = db.query<{ id: string }, [number]>("SELECT id FROM plan_session WHERE workspace_id = ?").all(workspace.id)
      .map((row) => row.id);
    const clearedPackets = db.query<{ count: number }, [number]>("SELECT COUNT(*) AS count FROM plan_packet WHERE workspace_id = ?")
      .get(workspace.id)?.count ?? 0;
    const clearedRounds = db.query<{ count: number }, [number]>(`
      SELECT COUNT(*) AS count
      FROM plan_round_transcript
      JOIN plan_session ON plan_session.id = plan_round_transcript.plan_session_id
      WHERE plan_session.workspace_id = ?
    `).get(workspace.id)?.count ?? 0;
    const detachedTasks = db.query<{ count: number }, [number, number]>(`
      SELECT COUNT(*) AS count
      FROM task
      WHERE workspace_id = ?
        AND plan_packet_id IN (SELECT id FROM plan_packet WHERE workspace_id = ?)
    `).get(workspace.id, workspace.id)?.count ?? 0;

    recordSystemEvent(db, createEvent({
      event_type: "plan.cleared",
      trace_id: createTraceId("plan"),
      workspace_id: workspace.id,
      session_id: null,
      source: "user",
      payload: {
        workspace_slug: workspace.slug,
        cleared_sessions: sessionIds.length,
        cleared_packets: clearedPackets,
        cleared_rounds: clearedRounds,
        detached_tasks: detachedTasks
      }
    }));

    db.query(`
      UPDATE task
      SET plan_packet_id = NULL, updated_at = ?
      WHERE workspace_id = ?
        AND plan_packet_id IN (SELECT id FROM plan_packet WHERE workspace_id = ?)
    `).run(nowIso(), workspace.id, workspace.id);
    db.query("DELETE FROM session WHERE workspace_id = ? AND mode = 'plan_mode'").run(workspace.id);
    db.query("DELETE FROM plan_session WHERE workspace_id = ?").run(workspace.id);

    return {
      workspace_id: workspace.id,
      workspace_slug: workspace.slug,
      session_ids: sessionIds,
      cleared_sessions: sessionIds.length,
      cleared_packets: clearedPackets,
      cleared_rounds: clearedRounds,
      detached_tasks: detachedTasks
    };
  });

  await Promise.all(summary.session_ids.map((sessionId) => rm(join(paths.sessionsDir, sessionId), { recursive: true, force: true })));
  const wikiPages = (await listWikiPages(`workspace/${summary.workspace_slug}`))
    .map((page) => page.page)
    .filter((page) => page.startsWith("plans/"));
  const clearedPages = wikiPages.length > 0
    ? (await deleteWikiPages(`workspace/${summary.workspace_slug}`, wikiPages, "llm", `plan: clear ${summary.workspace_slug}`)).length
    : 0;
  await rebuildSearchIndex(paths);

  return {
    workspace_id: summary.workspace_id,
    workspace_slug: summary.workspace_slug,
    cleared_sessions: summary.cleared_sessions,
    cleared_packets: summary.cleared_packets,
    cleared_rounds: summary.cleared_rounds,
    detached_tasks: summary.detached_tasks,
    cleared_pages: clearedPages
  };
}

export async function generateTasksFromPlan(planIdOrSessionId: string): Promise<{ tasks: WardTask[] }> {
  const detail = getPlanDetail(planIdOrSessionId);
  if (!detail.packet || detail.packet.status !== "approved") {
    throw new Error("Plan must be approved before generating tasks");
  }
  const paths = resolveWardPaths();
  const tasks: WardTask[] = [];
  const taskDir = join(paths.workspacesDir, detail.session.workspace_slug, "tasks");
  await mkdir(taskDir, { recursive: true, mode: 0o700 });

  for (const entry of detail.packet.tasks) {
    const existing = withDb((db) => db.query<{ id: string }, [string, string]>(
      "SELECT id FROM task WHERE plan_packet_id = ? AND title = ?"
    ).get(detail.packet!.packet_id, entry.title));
    if (existing) {
      continue;
    }
    const task = createTask({
      workspace_id: detail.packet.workspace_id,
      title: entry.title,
      description: entry.description,
      type: "feature",
      priority: priorityToTaskPriority(entry.priority),
      source: "plan_mode",
      owner: "ward",
      assignee_kind: entry.assignee_hint,
      plan_packet_id: detail.packet.packet_id,
      contract: {
        goal: entry.description,
        constraints: detail.packet.constraints,
        acceptance_criteria: entry.acceptance_criteria.map((criterion, index) => ({
          id: `AC${index + 1}`,
          statement: criterion,
          verification: "test",
          required: true
        })),
        file_plan: [],
        reporting_format: "handoff",
        max_iterations: 3
      }
    });
    const taskDocPath = join(taskDir, `${task.id}.md`);
    await writeFile(taskDocPath, hardMemoryTaskDoc(task, detail.packet, entry), "utf8");
    withDb((db) => db.query("UPDATE task SET task_doc_path = ?, updated_at = ? WHERE id = ?").run(taskDocPath, nowIso(), task.id));
    tasks.push({ ...task, task_doc_path: taskDocPath });
  }
  return { tasks };
}

export async function publishPlanTasksExternal(planIdOrSessionId: string): Promise<{ ok: false; reason: string }> {
  getPlanDetail(planIdOrSessionId);
  return { ok: false, reason: "External PM publishing lands after MCP connections in Task 009." };
}

export async function ensurePlanRuntimeWatchers(): Promise<ReturnType<typeof setInterval>> {
  await refreshAllSnapshotsQuietly();
  const timer = setInterval(() => {
    void refreshChangedSnapshotsQuietly();
  }, 2000);
  timer.unref?.();
  return timer;
}

async function refreshAllSnapshotsQuietly(): Promise<void> {
  await refreshAllRepoSnapshots().catch(() => undefined);
}

async function refreshChangedSnapshotsQuietly(): Promise<void> {
  await refreshChangedRepoSnapshots().catch(() => undefined);
}
