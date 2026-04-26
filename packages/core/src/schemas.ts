import { z } from "zod";

export const ISO_DATE_SCHEMA = z.string().datetime();

export const AutonomyLevelSchema = z.enum(["strict", "standard", "lenient"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

export const PresenceDefaultSchema = z.enum(["present", "away", "dnd"]);

export const UserProfileSchema = z.object({
  id: z.literal("self"),
  display_name: z.string(),
  honorific: z.string().nullable(),
  timezone: z.string(),
  work_hours_start: z.string(),
  work_hours_end: z.string(),
  quiet_hours_start: z.string(),
  quiet_hours_end: z.string(),
  persona_tone: z.string(),
  tts_enabled: z.boolean(),
  tts_voice: z.string().nullable(),
  tts_rate: z.number(),
  tts_pitch: z.number(),
  presence_default: PresenceDefaultSchema,
  created_at: z.string(),
  updated_at: z.string()
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const ProfilePatchSchema = z.object({
  display_name: z.string().min(1).optional(),
  honorific: z.string().nullable().optional(),
  timezone: z.string().min(1).optional(),
  work_hours_start: z.string().optional(),
  work_hours_end: z.string().optional(),
  quiet_hours_start: z.string().optional(),
  quiet_hours_end: z.string().optional(),
  persona_tone: z.string().optional(),
  tts_enabled: z.boolean().optional(),
  tts_voice: z.string().nullable().optional(),
  tts_rate: z.number().optional(),
  tts_pitch: z.number().optional(),
  presence_default: PresenceDefaultSchema.optional()
});
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

export const WorkspaceStatusSchema = z.enum(["active", "archived"]);

export const WorkspaceSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  status: WorkspaceStatusSchema,
  primary_repo_path: z.string().nullable(),
  autonomy_level: AutonomyLevelSchema,
  last_opened_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceRepoSchema = z.object({
  id: z.number().int().positive(),
  workspace_id: z.number().int().positive(),
  local_path: z.string(),
  branch: z.string().nullable(),
  is_primary: z.boolean(),
  watch_enabled: z.boolean()
});
export type WorkspaceRepo = z.infer<typeof WorkspaceRepoSchema>;

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(""),
  repo: z.string().optional(),
  autonomy_level: AutonomyLevelSchema.optional().default("standard")
});
export type CreateWorkspaceInput = z.input<typeof CreateWorkspaceSchema>;

export const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: WorkspaceStatusSchema.optional(),
  autonomy_level: AutonomyLevelSchema.optional(),
  primary_repo_path: z.string().nullable().optional()
});
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;

export const AttachmentKindSchema = z.enum(["markdown", "text", "pdf"]);
export const AttachmentSchema = z.object({
  id: z.string(),
  workspace_id: z.number().int().positive(),
  name: z.string(),
  source_path: z.string().nullable(),
  storage_path: z.string(),
  text_path: z.string(),
  kind: AttachmentKindSchema,
  bytes: z.number().int().nonnegative(),
  created_at: z.string()
});
export type WardAttachment = z.infer<typeof AttachmentSchema>;

export const TaskStatusSchema = z.enum([
  "idea",
  "planned",
  "approved",
  "queued",
  "in_progress",
  "needs_user",
  "needs_work",
  "blocked",
  "ready_to_ship",
  "shipped",
  "done",
  "canceled"
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPhaseSchema = z.enum([
  "intake",
  "planning",
  "approval",
  "implementation",
  "quality_gate",
  "testing",
  "qa_supervision",
  "documentation",
  "reporting",
  "shipping",
  "closed"
]);
export type TaskPhase = z.infer<typeof TaskPhaseSchema>;

export const TaskTypeSchema = z.enum(["epic", "feature", "bug", "chore", "research", "release"]);
export const TaskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export const TaskSourceSchema = z.enum(["user", "plan_mode", "inbound", "scheduler", "external_sync"]);
export const TaskOwnerSchema = z.enum(["user", "ward", "external"]);

export const TaskSchema = z.object({
  id: z.string(),
  workspace_id: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  lifecycle_phase: TaskPhaseSchema,
  type: TaskTypeSchema,
  priority: TaskPrioritySchema,
  source: TaskSourceSchema,
  owner: TaskOwnerSchema,
  autonomy_level: AutonomyLevelSchema,
  task_doc_path: z.string().nullable(),
  evidence_packet_path: z.string().nullable(),
  assignee_kind: z.string().nullable(),
  plan_packet_id: z.string().nullable(),
  parent_task_id: z.string().nullable(),
  external_ref_json: z.unknown().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});
export type WardTask = z.infer<typeof TaskSchema>;

export const AcceptanceCriterionSchema = z.object({
  id: z.string(),
  statement: z.string(),
  verification: z.enum(["test", "review", "screenshot", "log", "manual"]),
  required: z.boolean()
});

export const FilePlanItemSchema = z.object({
  path: z.string(),
  intent: z.enum(["create", "modify", "delete", "inspect"]),
  owner_agent: z.string().optional()
});

export const TaskContractSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  goal: z.string(),
  constraints: z.array(z.string()),
  acceptance_criteria: z.array(AcceptanceCriterionSchema),
  file_plan: z.array(FilePlanItemSchema),
  reporting_format: z.enum(["pr", "release_note", "handoff", "none"]),
  max_iterations: z.number().int().positive(),
  created_at: z.string()
});
export type WardTaskContract = z.infer<typeof TaskContractSchema>;

export const CreateTaskSchema = z.object({
  workspace_id: z.number().int().positive().optional(),
  workspace_slug: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional().default(""),
  type: TaskTypeSchema.optional().default("feature"),
  priority: TaskPrioritySchema.optional().default("medium"),
  source: TaskSourceSchema.optional().default("user"),
  owner: TaskOwnerSchema.optional().default("user"),
  autonomy_level: AutonomyLevelSchema.optional(),
  task_doc_path: z.string().optional(),
  evidence_packet_path: z.string().optional(),
  assignee_kind: z.string().optional(),
  plan_packet_id: z.string().optional(),
  parent_task_id: z.string().optional(),
  external_ref_json: z.unknown().optional(),
  contract: z.object({
    goal: z.string(),
    constraints: z.array(z.string()).optional().default([]),
    acceptance_criteria: z.array(AcceptanceCriterionSchema).optional().default([]),
    file_plan: z.array(FilePlanItemSchema).optional().default([]),
    reporting_format: z.enum(["pr", "release_note", "handoff", "none"]).optional().default("none"),
    max_iterations: z.number().int().positive().optional().default(3)
  }).optional()
});
export type CreateTaskInput = z.input<typeof CreateTaskSchema>;

export const TransitionTaskSchema = z.object({
  status: TaskStatusSchema,
  phase: TaskPhaseSchema.optional(),
  reason: z.string().optional().default("manual transition")
});
export type TransitionTaskInput = z.infer<typeof TransitionTaskSchema>;

export const GateTypeSchema = z.enum([
  "planning_scope",
  "scope_expansion",
  "destructive_action",
  "external_network",
  "external_post",
  "secret_access",
  "qa_failure",
  "ship_decision"
]);

export const GateStatusSchema = z.enum(["open", "approved", "rejected", "expired"]);
export const GateRequestedBySchema = z.enum(["orchestrator", "agent", "harness", "mcp"]);

export const TaskGateSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  gate_type: GateTypeSchema,
  reason: z.string(),
  requested_by: GateRequestedBySchema,
  status: GateStatusSchema,
  created_at: z.string(),
  resolved_at: z.string().nullable(),
  resolution_note: z.string().nullable()
});
export type TaskGate = z.infer<typeof TaskGateSchema>;

export const OpenGateSchema = z.object({
  gate_type: GateTypeSchema,
  reason: z.string().min(1),
  requested_by: GateRequestedBySchema.optional().default("orchestrator")
});
export type OpenGateInput = z.input<typeof OpenGateSchema>;

export const ResolveGateSchema = z.object({
  gate_id: z.string().optional(),
  note: z.string().optional()
});
export type ResolveGateInput = z.infer<typeof ResolveGateSchema>;

export const TaskArtifactSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  artifact_kind: z.string(),
  path: z.string().nullable(),
  url: z.string().nullable(),
  checksum: z.string().nullable(),
  redacted: z.boolean(),
  created_at: z.string()
});
export type TaskArtifact = z.infer<typeof TaskArtifactSchema>;

export const AddArtifactSchema = z.object({
  artifact_kind: z.string().optional().default("file"),
  path: z.string().optional(),
  url: z.string().optional(),
  checksum: z.string().optional(),
  redacted: z.boolean().optional().default(false)
}).refine((value) => value.path || value.url, {
  message: "Either path or url is required"
});
export type AddArtifactInput = z.input<typeof AddArtifactSchema>;

export const PreferenceSchema = z.object({
  id: z.number().int().positive(),
  scope: z.enum(["global", "workspace", "repo"]),
  workspace_id: z.number().int().positive().nullable(),
  key: z.string(),
  value_json: z.unknown(),
  source: z.enum(["user", "inferred", "system"]),
  confidence: z.number(),
  updated_at: z.string()
});
export type Preference = z.infer<typeof PreferenceSchema>;

export const RuntimeHealthSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  uptime_ms: z.number().int().nonnegative(),
  schema_version: z.number().int().nonnegative(),
  timestamp: z.string(),
  trace_id: z.string()
});
export type RuntimeHealth = z.infer<typeof RuntimeHealthSchema>;

export const DoctorCheckSchema = z.object({
  name: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  detail: z.string().optional()
});
export type DoctorCheck = z.infer<typeof DoctorCheckSchema>;

export const CliResultSchema = z.object({
  ok: z.boolean(),
  command: z.string(),
  timestamp: z.string(),
  message: z.string().optional(),
  data: z.unknown().optional()
});
export type CliResult = z.infer<typeof CliResultSchema>;

export const WardEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(),
  trace_id: z.string(),
  timestamp: z.string(),
  workspace_id: z.number().int().nullable(),
  session_id: z.string().nullable(),
  source: z.enum([
    "runtime",
    "harness",
    "agent",
    "orchestrator",
    "mcp",
    "user",
    "inbound",
    "scheduler"
  ]),
  payload: z.unknown(),
  version: z.literal(1)
});
export type WardEvent = z.infer<typeof WardEventSchema>;

export function nowIso(): string {
  return new Date().toISOString();
}

export function createTraceId(prefix = "trace"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createEvent(input: Omit<WardEvent, "event_id" | "timestamp" | "version">): WardEvent {
  return WardEventSchema.parse({
    ...input,
    event_id: crypto.randomUUID(),
    timestamp: nowIso(),
    version: 1
  });
}
