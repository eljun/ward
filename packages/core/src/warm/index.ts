import { z } from "zod";

export const BriefRangeSchema = z.enum(["today", "yesterday"]);
export type BriefRange = z.infer<typeof BriefRangeSchema>;

export const BriefWorkspaceSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  open_tasks: z.number().int().nonnegative(),
  blockers: z.number().int().nonnegative()
});
export type BriefWorkspace = z.infer<typeof BriefWorkspaceSchema>;

export const BriefTaskSignalSchema = z.object({
  workspace_id: z.number().int().positive(),
  workspace_slug: z.string(),
  workspace_name: z.string(),
  task_id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  reason: z.string()
});
export type BriefTaskSignal = z.infer<typeof BriefTaskSignalSchema>;

export const BriefNextActionSchema = z.object({
  workspace_slug: z.string().nullable(),
  task_id: z.string().nullable(),
  title: z.string(),
  action: z.string()
});
export type BriefNextAction = z.infer<typeof BriefNextActionSchema>;

export const BriefSessionSummarySchema = z.object({
  id: z.string(),
  workspace_id: z.number().int().positive().nullable(),
  workspace_slug: z.string().nullable(),
  task_id: z.string().nullable(),
  status: z.string(),
  summary: z.string(),
  duration_ms: z.number().int().nonnegative(),
  ended_at: z.string().nullable()
});
export type BriefSessionSummary = z.infer<typeof BriefSessionSummarySchema>;

export const DailyBriefSchema = z.object({
  key: z.string(),
  local_date: z.string(),
  range: BriefRangeSchema,
  timezone: z.string(),
  generated_at: z.string(),
  structured_hash: z.string(),
  greeting: z.string(),
  narration: z.string(),
  speak: z.boolean(),
  counts: z.object({
    active_workspaces: z.number().int().nonnegative(),
    open_tasks: z.number().int().nonnegative(),
    blockers: z.number().int().nonnegative(),
    sessions_completed: z.number().int().nonnegative(),
    sessions_failed: z.number().int().nonnegative()
  }),
  workspaces: z.array(BriefWorkspaceSchema),
  blockers: z.array(BriefTaskSignalSchema),
  next_actions: z.array(BriefNextActionSchema),
  sessions: z.object({
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    recent: z.array(BriefSessionSummarySchema)
  }),
  calendar: z.null()
});
export type DailyBrief = z.infer<typeof DailyBriefSchema>;

export const OutcomeRecordSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  workspace_id: z.number().int().positive().nullable(),
  task_id: z.string().nullable(),
  status: z.enum(["completed", "failed"]),
  outcome_summary: z.string(),
  key_changes: z.array(z.string()),
  artifacts: z.array(z.string()),
  blockers: z.array(z.string()),
  handoff: z.string(),
  wiki_commit: z.string().nullable(),
  created_at: z.string()
});
export type OutcomeRecord = z.infer<typeof OutcomeRecordSchema>;

export const WardSessionSchema = z.object({
  id: z.string(),
  workspace_id: z.number().int().positive().nullable(),
  task_id: z.string().nullable(),
  brain_id: z.string().nullable(),
  runtime_kind: z.string().nullable(),
  mode: z.string().nullable(),
  lifecycle_state: z.string().nullable(),
  summary: z.string().nullable(),
  started_at: z.string(),
  ended_at: z.string().nullable()
});
export type WardSession = z.infer<typeof WardSessionSchema>;

export const SimulateSessionSchema = z.object({
  workspace_slug: z.string().min(1),
  task_id: z.string().optional(),
  status: z.enum(["completed", "failed"]).optional().default("completed"),
  summary: z.string().optional(),
  duration_ms: z.number().int().nonnegative().optional().default(300000),
  key_changes: z.array(z.string()).optional().default([]),
  artifacts: z.array(z.string()).optional().default([]),
  blockers: z.array(z.string()).optional().default([]),
  architecture_touched: z.boolean().optional().default(false)
});
export type SimulateSessionInput = z.input<typeof SimulateSessionSchema>;

export const WarmCacheEntryMetaSchema = z.object({
  key: z.string(),
  stale: z.boolean(),
  refreshed_at: z.string(),
  expires_at: z.string(),
  hits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
  size_bytes: z.number().int().nonnegative()
});
export type WarmCacheEntryMeta = z.infer<typeof WarmCacheEntryMetaSchema>;

export const WarmCacheStatsSchema = z.object({
  entries: z.array(WarmCacheEntryMetaSchema),
  reads: z.number().int().nonnegative(),
  hits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
  hit_rate: z.number().nonnegative(),
  miss_rate: z.number().nonnegative(),
  generated_at: z.string()
});
export type WarmCacheStats = z.infer<typeof WarmCacheStatsSchema>;

export const OverviewSchema = z.object({
  generated_at: z.string(),
  profile: z.object({
    display_name: z.string(),
    honorific: z.string().nullable(),
    timezone: z.string(),
    tts_enabled: z.boolean(),
    tts_voice: z.string().nullable(),
    tts_rate: z.number(),
    tts_pitch: z.number()
  }),
  brief: DailyBriefSchema,
  active_workspaces: z.array(BriefWorkspaceSchema),
  running_sessions: z.array(WardSessionSchema),
  recent_handoffs: z.array(OutcomeRecordSchema),
  blockers: z.array(BriefTaskSignalSchema),
  cache: WarmCacheStatsSchema
});
export type Overview = z.infer<typeof OverviewSchema>;
