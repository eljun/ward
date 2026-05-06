import { z } from "zod";
import { AutonomyLevelSchema, ISO_DATE_SCHEMA, WardEventSchema } from "../schemas.ts";

export const HarnessModeSchema = z.enum(["visible", "headless"]);
export type HarnessMode = z.infer<typeof HarnessModeSchema>;

export const HarnessRuntimeKindSchema = z.enum(["cli", "sdk", "api", "local"]);
export type HarnessRuntimeKind = z.infer<typeof HarnessRuntimeKindSchema>;

export const HarnessLifecycleStateSchema = z.enum([
  "queued",
  "initializing",
  "implementing",
  "testing",
  "creating_artifacts",
  "awaiting_approval",
  "done",
  "failed",
  "blocked",
  "canceled"
]);
export type HarnessLifecycleState = z.infer<typeof HarnessLifecycleStateSchema>;

export const HarnessTimeoutsSchema = z.object({
  wall_clock_max_ms: z.number().int().positive(),
  idle_max_ms: z.number().int().positive()
});
export type HarnessTimeouts = z.infer<typeof HarnessTimeoutsSchema>;

export const HarnessAcceptanceCriterionSchema = z.object({
  id: z.string().optional(),
  statement: z.string(),
  verification: z.enum(["test", "review", "screenshot", "log", "manual"]).optional().default("test"),
  required: z.boolean().optional().default(true)
});
export type HarnessAcceptanceCriterion = z.infer<typeof HarnessAcceptanceCriterionSchema>;

export const HarnessTaskContractSchema = z.object({
  task_id: z.string().nullable().optional(),
  goal: z.string(),
  constraints: z.array(z.string()),
  acceptance_criteria: z.array(HarnessAcceptanceCriterionSchema),
  source_docs: z.array(z.string()),
  reporting_format: z.enum(["stream-json", "markdown", "structured"]),
  max_iterations: z.number().int().positive().optional()
});
export type HarnessTaskContract = z.infer<typeof HarnessTaskContractSchema>;

export const ContextPacketSchema = z.object({
  workspace_summary: z.string(),
  recent_sessions: z.array(z.string()),
  relevant_wiki_refs: z.array(z.object({
    page: z.string(),
    excerpt: z.string()
  })),
  durable_artifact_refs: z.array(z.object({
    kind: z.string(),
    path: z.string(),
    excerpt: z.string().optional()
  })),
  active_blockers: z.array(z.string()),
  repo_snapshot_ref: z.string(),
  preferences_excerpt: z.record(z.string(), z.unknown()),
  trace_id: z.string()
});
export type ContextPacket = z.infer<typeof ContextPacketSchema>;

export const HarnessLaunchSchema = z.object({
  session_id: z.string(),
  workspace_id: z.number().int().positive(),
  task_id: z.string().nullable(),
  brain_id: z.string(),
  runtime_kind: HarnessRuntimeKindSchema,
  mode: HarnessModeSchema,
  working_dir: z.string(),
  task_contract: HarnessTaskContractSchema,
  context_packet: ContextPacketSchema,
  allowed_tools: z.array(z.string()),
  mcp_overlay_path: z.string(),
  timeouts: HarnessTimeoutsSchema,
  autonomy_level: AutonomyLevelSchema,
  incognito: z.boolean().default(false),
  created_at: ISO_DATE_SCHEMA,
  scenario: z.string().default("default")
});
export type HarnessLaunch = z.infer<typeof HarnessLaunchSchema>;

export const LaunchSessionSchema = z.object({
  workspace_slug: z.string().min(1),
  task_id: z.string().optional(),
  brain_id: z.string().optional().default("stub-worker"),
  runtime_kind: HarnessRuntimeKindSchema.optional().default("local"),
  mode: HarnessModeSchema.optional().default("headless"),
  scenario: z.enum([
    "default",
    "fails",
    "await-approval",
    "tool-denied",
    "idle-timeout",
    "visible-echo",
    "qa-missing-evidence",
    "file-write",
    "throughput",
    "long-running"
  ]).optional().default("default"),
  goal: z.string().optional(),
  constraints: z.array(z.string()).optional().default([]),
  acceptance_criteria: z.array(z.string()).optional().default([]),
  source_docs: z.array(z.string()).optional().default([]),
  allowed_tools: z.array(z.string()).optional().default(["ward.status"]),
  incognito: z.boolean().optional().default(false),
  autonomy_level: AutonomyLevelSchema.optional(),
  wall_clock_max_ms: z.number().int().positive().optional().default(900000),
  idle_max_ms: z.number().int().positive().optional().default(180000)
});
export type LaunchSessionInput = z.input<typeof LaunchSessionSchema>;

export const SessionListFiltersSchema = z.object({
  workspace: z.string().optional(),
  state: HarnessLifecycleStateSchema.optional(),
  include_incognito: z.boolean().optional().default(false)
});
export type SessionListFilters = z.infer<typeof SessionListFiltersSchema>;

export const HarnessSessionSchema = z.object({
  id: z.string(),
  workspace_id: z.number().int().positive().nullable(),
  workspace_slug: z.string().nullable(),
  task_id: z.string().nullable(),
  task_title: z.string().nullable(),
  brain_id: z.string().nullable(),
  runtime_kind: z.string().nullable(),
  mode: z.string().nullable(),
  lifecycle_state: z.string().nullable(),
  queue_state: z.string().nullable(),
  queue_position: z.number().int().positive().nullable(),
  working_dir: z.string().nullable(),
  summary: z.string().nullable(),
  incognito: z.boolean(),
  worker_pid: z.number().int().positive().nullable(),
  trace_id: z.string().nullable(),
  scenario: z.string().nullable(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  updated_at: z.string()
});
export type HarnessSession = z.infer<typeof HarnessSessionSchema>;

export const HarnessSessionPathsSchema = z.object({
  session_dir: z.string(),
  task_contract_path: z.string(),
  context_packet_path: z.string(),
  mcp_overlay_path: z.string(),
  events_path: z.string(),
  artifacts_dir: z.string(),
  summary_path: z.string(),
  pty_raw_path: z.string()
});
export type HarnessSessionPaths = z.infer<typeof HarnessSessionPathsSchema>;

export const HarnessSessionDetailSchema = z.object({
  session: HarnessSessionSchema,
  launch: HarnessLaunchSchema,
  paths: HarnessSessionPathsSchema,
  events: z.array(WardEventSchema),
  artifacts: z.array(z.string()),
  pty_output: z.string()
});
export type HarnessSessionDetail = z.infer<typeof HarnessSessionDetailSchema>;

export const StubWorkerEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    state: HarnessLifecycleStateSchema,
    detail: z.string(),
    progress_pct: z.number().min(0).max(1)
  }),
  z.object({
    type: z.literal("message"),
    role: z.enum(["assistant", "system"]),
    text: z.string()
  }),
  z.object({
    type: z.literal("artifact"),
    artifact_kind: z.string(),
    path: z.string(),
    note: z.string().optional()
  }),
  z.object({
    type: z.literal("tool_call"),
    tool_name: z.string(),
    input: z.unknown().optional()
  }),
  z.object({
    type: z.literal("agent_signal"),
    agent_id: z.string(),
    status: z.enum(["pass", "needs_work", "blocked"]),
    summary: z.string(),
    missing_evidence: z.array(z.string()).optional()
  }),
  z.object({
    type: z.literal("file_write"),
    relative_path: z.string(),
    body: z.string()
  }),
  z.object({
    type: z.literal("tool_denied"),
    tool_name: z.string(),
    reason: z.string()
  })
]);
export type StubWorkerEnvelope = z.infer<typeof StubWorkerEnvelopeSchema>;
