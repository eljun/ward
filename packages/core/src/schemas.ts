import { z } from "zod";

export const ISO_DATE_SCHEMA = z.string().datetime();

export const AutonomyLevelSchema = z.enum(["strict", "standard", "lenient"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

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
