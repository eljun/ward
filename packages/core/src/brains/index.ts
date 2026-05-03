import { z } from "zod";

export const BrainKindSchema = z.enum([
  "stub",
  "claude",
  "codex",
  "openai",
  "openai-compatible",
  "anthropic-api",
  "google",
  "xai",
  "local"
]);
export type BrainKind = z.infer<typeof BrainKindSchema>;

export const BrainRuntimeSchema = z.enum(["cli", "sdk", "api", "local", "simulated"]);
export type BrainRuntime = z.infer<typeof BrainRuntimeSchema>;

export const BrainAuthSchema = z.enum(["subscription", "api_key", "none"]);
export type BrainAuth = z.infer<typeof BrainAuthSchema>;

export const BrainAccountingSchema = z.enum(["subscription", "api", "local"]);
export type BrainAccounting = z.infer<typeof BrainAccountingSchema>;

export const BrainCapabilitiesSchema = z.object({
  tool_use: z.boolean().default(false),
  streaming: z.boolean().default(false),
  json_mode: z.boolean().default(false),
  max_context: z.number().int().positive().nullable().default(null)
});
export type BrainCapabilities = z.infer<typeof BrainCapabilitiesSchema>;

export const BrainConfigSchema = z.object({
  id: z.string().min(1),
  kind: BrainKindSchema,
  runtime: BrainRuntimeSchema,
  auth: BrainAuthSchema,
  model: z.string().nullable(),
  base_url: z.string().nullable(),
  secret_ref: z.string().nullable(),
  env: z.record(z.string(), z.string()).default({}),
  tags: z.array(z.string()).default([]),
  capabilities: BrainCapabilitiesSchema,
  concurrency_cap: z.number().int().positive().default(1),
  enabled: z.boolean().default(true),
  accounting: BrainAccountingSchema,
  source: z.enum(["system", "user"]).default("system"),
  created_at: z.string(),
  updated_at: z.string()
});
export type BrainConfig = z.infer<typeof BrainConfigSchema>;

export const BrainRouteSchema = z.object({
  concern: z.string().min(1),
  brain_ids: z.array(z.string().min(1)).min(1),
  updated_at: z.string()
});
export type BrainRoute = z.infer<typeof BrainRouteSchema>;

export const BrainRegistrySchema = z.object({
  brains: z.array(BrainConfigSchema),
  routing: z.array(BrainRouteSchema)
});
export type BrainRegistry = z.infer<typeof BrainRegistrySchema>;

export const CostLedgerEntrySchema = z.object({
  id: z.string(),
  brain_id: z.string(),
  accounting_mode: BrainAccountingSchema,
  trigger: z.string(),
  workspace_id: z.number().int().positive().nullable(),
  session_id: z.string().nullable(),
  trace_id: z.string(),
  tokens_in: z.number().int().nonnegative(),
  tokens_out: z.number().int().nonnegative(),
  dollars_estimate: z.number().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  invocations: z.number().int().nonnegative(),
  created_at: z.string()
});
export type CostLedgerEntry = z.infer<typeof CostLedgerEntrySchema>;

export const RecordCostLedgerEntrySchema = z.object({
  brain_id: z.string().min(1),
  accounting_mode: BrainAccountingSchema,
  trigger: z.string().min(1),
  workspace_id: z.number().int().positive().nullable().optional(),
  session_id: z.string().nullable().optional(),
  trace_id: z.string().min(1),
  tokens_in: z.number().int().nonnegative().optional().default(0),
  tokens_out: z.number().int().nonnegative().optional().default(0),
  dollars_estimate: z.number().nonnegative().optional().default(0),
  duration_ms: z.number().int().nonnegative().optional().default(0),
  invocations: z.number().int().nonnegative().optional().default(1)
});
export type RecordCostLedgerEntryInput = z.input<typeof RecordCostLedgerEntrySchema>;

export const CostLedgerSummarySchema = z.object({
  date: z.string(),
  entries: z.number().int().nonnegative(),
  totals: z.object({
    invocations: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
    tokens_in: z.number().int().nonnegative(),
    tokens_out: z.number().int().nonnegative(),
    dollars_estimate: z.number().nonnegative()
  }),
  by_brain: z.array(z.object({
    brain_id: z.string(),
    accounting_mode: BrainAccountingSchema,
    invocations: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
    tokens_in: z.number().int().nonnegative(),
    tokens_out: z.number().int().nonnegative(),
    dollars_estimate: z.number().nonnegative()
  }))
});
export type CostLedgerSummary = z.infer<typeof CostLedgerSummarySchema>;

export const QuotaMetricSchema = z.enum(["invocations", "tokens", "dollars", "duration_ms", "failures", "requests"]);
export type QuotaMetric = z.infer<typeof QuotaMetricSchema>;

export const QuotaLedgerEntrySchema = z.object({
  id: z.string(),
  policy_id: z.string(),
  scope: z.enum(["global", "brain", "workspace", "channel", "mcp_server", "user"]),
  target: z.string(),
  metric: QuotaMetricSchema,
  window: z.string(),
  window_start: z.string(),
  amount: z.number().nonnegative(),
  trace_id: z.string(),
  workspace_id: z.number().int().positive().nullable(),
  session_id: z.string().nullable(),
  created_at: z.string()
});
export type QuotaLedgerEntry = z.infer<typeof QuotaLedgerEntrySchema>;

export const CostForecastSchema = z.object({
  generated_at: z.string(),
  forecasts: z.array(z.object({
    brain_id: z.string(),
    metric: QuotaMetricSchema,
    current: z.number().nonnegative(),
    limit: z.number().positive().nullable(),
    projected_breach_at: z.string().nullable(),
    status: z.enum(["ok", "watch", "unknown"])
  }))
});
export type CostForecast = z.infer<typeof CostForecastSchema>;
