/**
 * Orb conductor plan schemas.
 *
 * The orb chat brain emits a JSON plan that the runtime validates before
 * executing each step against existing W.A.R.D handlers. Validation lives
 * here so both the runtime and any future client can reuse it.
 */

import { z } from "zod";
import { TaskTypeSchema, TaskPrioritySchema } from "../schemas.ts";
import { HarnessModeSchema } from "../harness/index.ts";

const StepRefSchema = z.string().regex(/^\$[1-9][0-9]*\.[a-z_][a-z0-9_]*$/i, {
  message: "Step references must look like `$1.id` or `$2.session_id`."
});

const TaskRefSchema = z.union([
  z.string().min(1),
  StepRefSchema
]);

export const OrbCreateTaskArgsSchema = z.object({
  workspace_slug: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().default(""),
  type: TaskTypeSchema.optional().default("feature"),
  priority: TaskPrioritySchema.optional().default("medium")
});
export type OrbCreateTaskArgs = z.infer<typeof OrbCreateTaskArgsSchema>;

export const OrbLaunchSessionArgsSchema = z.object({
  workspace_slug: z.string().min(1),
  task_ref: TaskRefSchema.optional(),
  brain_id: z.string().min(1).optional().default("stub-worker"),
  mode: HarnessModeSchema.optional().default("headless"),
  goal: z.string().min(1)
});
export type OrbLaunchSessionArgs = z.infer<typeof OrbLaunchSessionArgsSchema>;

export const OrbReadOverviewArgsSchema = z.object({}).strict();
export type OrbReadOverviewArgs = z.infer<typeof OrbReadOverviewArgsSchema>;

export const OrbReadSessionArgsSchema = z.object({
  session_ref: TaskRefSchema
});
export type OrbReadSessionArgs = z.infer<typeof OrbReadSessionArgsSchema>;

export const OrbReadWorkspaceArgsSchema = z.object({
  workspace_slug: z.string().min(1)
});
export type OrbReadWorkspaceArgs = z.infer<typeof OrbReadWorkspaceArgsSchema>;

export const OrbStepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create_task"), args: OrbCreateTaskArgsSchema }),
  z.object({ kind: z.literal("launch_session"), args: OrbLaunchSessionArgsSchema }),
  z.object({ kind: z.literal("read_overview"), args: OrbReadOverviewArgsSchema.optional().default({}) }),
  z.object({ kind: z.literal("read_session"), args: OrbReadSessionArgsSchema }),
  z.object({ kind: z.literal("read_workspace"), args: OrbReadWorkspaceArgsSchema })
]);
export type OrbStep = z.infer<typeof OrbStepSchema>;

export const OrbStepKindSchema = z.enum([
  "create_task",
  "launch_session",
  "read_overview",
  "read_session",
  "read_workspace"
]);
export type OrbStepKind = z.infer<typeof OrbStepKindSchema>;

export const OrbPlanSchema = z.object({
  intent: z.string().min(1).max(280),
  needs_confirmation: z.boolean().optional().default(false),
  steps: z.array(OrbStepSchema).min(1).max(8)
});
export type OrbPlan = z.infer<typeof OrbPlanSchema>;
export type OrbPlanInput = z.input<typeof OrbPlanSchema>;

/**
 * Steps that always force user confirmation regardless of the planner's flag.
 * Anything that consumes brain time / quota lives here.
 */
export const ORB_CONFIRM_REQUIRED_KINDS: ReadonlySet<OrbStepKind> = new Set<OrbStepKind>([
  "launch_session"
]);

export function planRequiresConfirmation(plan: OrbPlan): boolean {
  if (plan.needs_confirmation) return true;
  return plan.steps.some((step) => ORB_CONFIRM_REQUIRED_KINDS.has(step.kind));
}
