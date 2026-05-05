import { z } from "zod";
import { AutonomyLevelSchema } from "../schemas.ts";

export const McpScopeSchema = z.enum(["global", "workspace", "repo"]);
export type McpScope = z.infer<typeof McpScopeSchema>;

export const McpEditableScopeSchema = z.enum(["global", "workspace"]);
export type McpEditableScope = z.infer<typeof McpEditableScopeSchema>;

export const McpTransportSchema = z.enum(["stdio", "http"]);
export type McpTransport = z.infer<typeof McpTransportSchema>;

export const McpToolClassSchema = z.enum(["read", "write", "destructive", "privileged"]);
export type McpToolClass = z.infer<typeof McpToolClassSchema>;

export const McpCapabilityProfileSchema = z.enum(["browser_qa", "repo_hosting", "deployment", "database"]);
export type McpCapabilityProfile = z.infer<typeof McpCapabilityProfileSchema>;

export const McpLifecycleStatusSchema = z.enum(["ok", "error", "disabled", "unsupported"]);
export type McpLifecycleStatus = z.infer<typeof McpLifecycleStatusSchema>;

export const McpToolSummarySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  input_schema: z.unknown().optional()
});
export type McpToolSummary = z.infer<typeof McpToolSummarySchema>;

export const McpToolClassificationSourceSchema = z.enum(["override", "explicit", "heuristic", "default"]);
export type McpToolClassificationSource = z.infer<typeof McpToolClassificationSourceSchema>;

export const McpToolClassificationSchema = z.object({
  tool_name: z.string(),
  tool_class: McpToolClassSchema,
  source: McpToolClassificationSourceSchema,
  matched_pattern: z.string().nullable()
});
export type McpToolClassification = z.infer<typeof McpToolClassificationSchema>;

export const McpPolicyDecisionSchema = z.object({
  tool_name: z.string(),
  tool_class: McpToolClassSchema,
  class_source: McpToolClassificationSourceSchema,
  matched_pattern: z.string().nullable(),
  autonomy_level: AutonomyLevelSchema,
  ci_green: z.boolean(),
  allowed_tools: z.array(z.string()),
  capability_profiles: z.array(McpCapabilityProfileSchema),
  allowed: z.boolean(),
  reasons: z.array(z.string()),
  denial_reason: z.string().nullable(),
  synthetic_result: z.object({
    type: z.literal("tool_not_allowed"),
    tool_name: z.string(),
    reason: z.string()
  }).nullable(),
  denial_payload: z.object({
    tool_name: z.string(),
    tool_class: McpToolClassSchema,
    autonomy_level: AutonomyLevelSchema,
    reason: z.string(),
    allowed_tools: z.array(z.string()),
    capability_profiles: z.array(McpCapabilityProfileSchema)
  }).nullable()
});
export type McpPolicyDecision = z.infer<typeof McpPolicyDecisionSchema>;

export const McpPolicyPreviewRequestSchema = z.object({
  workspace: z.string().optional(),
  server_id: z.string().optional(),
  tool_name: z.string().min(1),
  tool_class: McpToolClassSchema.optional(),
  autonomy_level: AutonomyLevelSchema.optional().default("standard"),
  allowed_tools: z.array(z.string()).optional(),
  capability_profiles: z.array(McpCapabilityProfileSchema).optional().default([]),
  ci_green: z.boolean().optional().default(false)
});
export type McpPolicyPreviewRequest = z.input<typeof McpPolicyPreviewRequestSchema>;

export const McpServerConfigSchema = z.object({
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
  transport: McpTransportSchema.optional().default("stdio"),
  url: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional().default({}),
  ward_tool_scopes: z.array(McpToolClassSchema).optional().default(["read"]),
  ward_enabled: z.boolean().optional().default(true),
  ward_tool_class_overrides: z.record(z.string(), McpToolClassSchema).optional().default({}),
  ward_capability_profiles: z.array(McpCapabilityProfileSchema).optional().default([])
}).passthrough().superRefine((config, context) => {
  if (config.transport === "stdio" && !config.command) {
    context.addIssue({
      code: "custom",
      message: "stdio MCP servers require command"
    });
  }
  if (config.transport === "http" && !config.url) {
    context.addIssue({
      code: "custom",
      message: "http MCP servers require url"
    });
  }
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpConfigFileSchema = z.object({
  mcpServers: z.record(z.string().min(1), McpServerConfigSchema).optional().default({})
}).passthrough();
export type McpConfigFile = z.infer<typeof McpConfigFileSchema>;

export const McpServerConfigPatchSchema = z.object({
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  transport: McpTransportSchema.optional(),
  url: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  ward_tool_scopes: z.array(McpToolClassSchema).optional(),
  ward_enabled: z.boolean().optional(),
  ward_tool_class_overrides: z.record(z.string(), McpToolClassSchema).optional(),
  ward_capability_profiles: z.array(McpCapabilityProfileSchema).optional()
}).passthrough();
export type McpServerConfigPatch = z.infer<typeof McpServerConfigPatchSchema>;

export const McpServerOriginSchema = z.object({
  scope: McpScopeSchema,
  path: z.string(),
  workspace_slug: z.string().optional(),
  repo_path: z.string().optional(),
  primary_repo: z.boolean().optional()
});
export type McpServerOrigin = z.infer<typeof McpServerOriginSchema>;

export const McpConflictSchema = z.object({
  server_id: z.string(),
  winner: McpServerOriginSchema,
  shadowed: McpServerOriginSchema,
  reason: z.string()
});
export type McpConflict = z.infer<typeof McpConflictSchema>;

export const EffectiveMcpServerSchema = z.object({
  id: z.string(),
  origin: McpServerOriginSchema,
  config: McpServerConfigSchema,
  conflicts: z.array(McpConflictSchema).default([])
});
export type EffectiveMcpServer = z.infer<typeof EffectiveMcpServerSchema>;

export const EffectiveMcpConfigSchema = z.object({
  workspace_id: z.number().int().positive().nullable(),
  workspace_slug: z.string().nullable(),
  include_repo: z.boolean(),
  generated_at: z.string(),
  servers: z.array(EffectiveMcpServerSchema),
  conflicts: z.array(McpConflictSchema)
});
export type EffectiveMcpConfig = z.infer<typeof EffectiveMcpConfigSchema>;

export const McpServerStatusSnapshotSchema = z.object({
  server_id: z.string(),
  workspace_id: z.number().int().positive().nullable(),
  workspace_slug: z.string().nullable(),
  scope: McpScopeSchema,
  origin_path: z.string(),
  transport: McpTransportSchema,
  enabled: z.boolean(),
  status: McpLifecycleStatusSchema,
  tool_count: z.number().int().nonnegative(),
  tools: z.array(McpToolSummarySchema),
  error: z.string().nullable(),
  stderr_log_path: z.string().nullable(),
  checked_at: z.string(),
  duration_ms: z.number().int().nonnegative(),
  trace_id: z.string()
});
export type McpServerStatusSnapshot = z.infer<typeof McpServerStatusSnapshotSchema>;

export const McpDoctorResultSchema = z.object({
  ok: z.boolean(),
  workspace_id: z.number().int().positive().nullable(),
  workspace_slug: z.string().nullable(),
  generated_at: z.string(),
  checks: z.array(McpServerStatusSnapshotSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative()
  })
});
export type McpDoctorResult = z.infer<typeof McpDoctorResultSchema>;

export const McpAddServerSchema = z.object({
  id: z.string().min(1).regex(/^[a-zA-Z0-9_.-]+$/, "server id may only contain letters, numbers, dot, underscore, and dash"),
  scope: McpEditableScopeSchema,
  workspace: z.string().optional(),
  config: McpServerConfigSchema
});
export type McpAddServerInput = z.input<typeof McpAddServerSchema>;

export const McpPatchServerSchema = z.object({
  scope: McpEditableScopeSchema,
  workspace: z.string().optional(),
  patch: McpServerConfigPatchSchema
});
export type McpPatchServerInput = z.input<typeof McpPatchServerSchema>;

export const McpDeleteServerSchema = z.object({
  scope: McpEditableScopeSchema,
  workspace: z.string().optional()
});
export type McpDeleteServerInput = z.input<typeof McpDeleteServerSchema>;

export const SecretScopeSchema = z.enum(["global", "workspace"]);
export type SecretScope = z.infer<typeof SecretScopeSchema>;

export const SecretBackendSchema = z.enum(["keychain", "file"]);
export type SecretBackend = z.infer<typeof SecretBackendSchema>;

export const SecretSetSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_.-]+$/, "secret name may only contain letters, numbers, dot, underscore, and dash"),
  scope: SecretScopeSchema.optional().default("global"),
  workspace: z.string().optional(),
  value: z.string().min(1)
});
export type SecretSetInput = z.input<typeof SecretSetSchema>;

export const SecretSelectorSchema = z.object({
  scope: SecretScopeSchema.optional().default("global"),
  workspace: z.string().optional()
});
export type SecretSelectorInput = z.input<typeof SecretSelectorSchema>;

export const SecretEntrySchema = z.object({
  name: z.string(),
  scope: SecretScopeSchema,
  workspace: z.string().nullable(),
  key: z.string(),
  backend: SecretBackendSchema,
  updated_at: z.string()
});
export type SecretEntry = z.infer<typeof SecretEntrySchema>;

export const SecretBackendStatusSchema = z.object({
  backend: SecretBackendSchema,
  forced: z.boolean(),
  available: z.boolean(),
  detail: z.string()
});
export type SecretBackendStatus = z.infer<typeof SecretBackendStatusSchema>;
