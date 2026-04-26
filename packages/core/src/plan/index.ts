import { z } from "zod";

export const PlanRoundNameSchema = z.enum(["context", "proposal", "critique", "convergence", "decision"]);
export type PlanRoundName = z.infer<typeof PlanRoundNameSchema>;

export const PlanStatusSchema = z.enum(["draft", "waiting_for_user", "approved", "superseded", "aborted"]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const ConvergencePolicySchema = z.enum(["consensus", "coordinator_decides", "user_decides"]);
export type ConvergencePolicy = z.infer<typeof ConvergencePolicySchema>;

export const PlanParticipantSchema = z.object({
  brain_id: z.string(),
  role: z.string()
});
export type PlanParticipant = z.infer<typeof PlanParticipantSchema>;

export const PlanRiskSchema = z.object({
  risk: z.string(),
  likelihood: z.enum(["low", "med", "high"]),
  mitigation: z.string()
});

export const PlanComponentSchema = z.object({
  name: z.string(),
  purpose: z.string()
});

export const PlanPhaseSchema = z.object({
  name: z.string(),
  goal: z.string(),
  deliverables: z.array(z.string()),
  dependencies: z.array(z.string())
});

export const PlanTaskEntrySchema = z.object({
  title: z.string(),
  description: z.string(),
  acceptance_criteria: z.array(z.string()),
  assignee_hint: z.enum(["claude", "codex", "either", "human"]),
  phase: z.string(),
  priority: z.enum(["high", "normal", "low"])
});
export type PlanTaskEntry = z.infer<typeof PlanTaskEntrySchema>;

export const PlanPacketSchema = z.object({
  packet_id: z.string(),
  workspace_id: z.number().int().positive(),
  version: z.number().int().positive(),
  status: PlanStatusSchema,
  title: z.string(),
  summary: z.string(),
  goals: z.array(z.string()),
  non_goals: z.array(z.string()),
  constraints: z.array(z.string()),
  assumptions: z.array(z.string()),
  risks: z.array(PlanRiskSchema),
  open_questions: z.array(z.string()),
  architecture: z.object({
    overview: z.string(),
    components: z.array(PlanComponentSchema),
    data_flow: z.string().optional()
  }),
  phases: z.array(PlanPhaseSchema),
  tasks: z.array(PlanTaskEntrySchema),
  first_recommended_action: z.string(),
  source: z.object({
    participants: z.array(PlanParticipantSchema),
    round_transcripts: z.array(z.string()),
    attachments_considered: z.array(z.string()),
    repo_snapshot_ref: z.string().nullable().optional(),
    convergence_policy: ConvergencePolicySchema.optional()
  }),
  approved_at: z.string().optional(),
  approved_by: z.literal("user").optional(),
  supersedes: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string()
});
export type PlanPacket = z.infer<typeof PlanPacketSchema>;

export const PlanContextOutputSchema = z.object({
  round: z.literal("context"),
  participant_id: z.string(),
  acknowledged: z.boolean(),
  clarifying_questions: z.array(z.string()),
  missing_context: z.array(z.string())
});

export const PlanProposalOutputSchema = z.object({
  round: z.literal("proposal"),
  participant_id: z.string(),
  approach_name: z.string(),
  summary: z.string(),
  architecture_sketch: z.string(),
  sequence: z.array(z.string()),
  risks: z.array(z.string()),
  effort_estimate: z.enum(["small", "medium", "large", "xl"]),
  assumptions: z.array(z.string())
});

export const PlanCritiqueOutputSchema = z.object({
  round: z.literal("critique"),
  participant_id: z.string(),
  reviews: z.array(z.object({
    target_participant_id: z.string(),
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    questions: z.array(z.string())
  }))
});

export const PlanConvergenceOutputSchema = z.object({
  round: z.literal("convergence"),
  participant_id: z.string(),
  ranking: z.array(z.string()),
  top_pick_rationale: z.string(),
  remaining_concerns: z.array(z.string())
});

export const PlanRoundOutputSchema = z.discriminatedUnion("round", [
  PlanContextOutputSchema,
  PlanProposalOutputSchema,
  PlanCritiqueOutputSchema,
  PlanConvergenceOutputSchema
]);
export type PlanRoundOutput = z.infer<typeof PlanRoundOutputSchema>;

export const PlanRoundTranscriptSchema = z.object({
  id: z.string(),
  plan_session_id: z.string(),
  plan_packet_id: z.string().nullable(),
  round_index: z.number().int().positive(),
  round_name: PlanRoundNameSchema,
  moderator_summary: z.string(),
  participants_json: z.array(PlanRoundOutputSchema),
  file_path: z.string(),
  created_at: z.string()
});
export type PlanRoundTranscript = z.infer<typeof PlanRoundTranscriptSchema>;

export const PlanSessionSchema = z.object({
  id: z.string(),
  workspace_id: z.number().int().positive(),
  workspace_slug: z.string(),
  status: PlanStatusSchema,
  current_round: PlanRoundNameSchema,
  prompt: z.string(),
  convergence_policy: ConvergencePolicySchema,
  clarifying_questions: z.array(z.string()),
  user_answers: z.array(z.string()),
  packet_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});
export type PlanSession = z.infer<typeof PlanSessionSchema>;

export const PlanDetailSchema = z.object({
  session: PlanSessionSchema,
  packet: PlanPacketSchema.nullable(),
  rounds: z.array(PlanRoundTranscriptSchema)
});
export type PlanDetail = z.infer<typeof PlanDetailSchema>;

export const StartPlanSchema = z.object({
  prompt: z.string().optional(),
  convergence_policy: ConvergencePolicySchema.optional(),
  force_clarification: z.boolean().optional().default(false)
});
export type StartPlanInput = z.input<typeof StartPlanSchema>;

export const AnswerPlanSchema = z.object({
  answers: z.array(z.string()).optional().default([]),
  answer: z.string().optional()
});
export type AnswerPlanInput = z.input<typeof AnswerPlanSchema>;

export const RevisePlanSchema = z.object({
  notes: z.string().min(1)
});
export type RevisePlanInput = z.infer<typeof RevisePlanSchema>;

export const RepoSnapshotSchema = z.object({
  id: z.string(),
  repo_id: z.number().int().positive(),
  workspace_id: z.number().int().positive(),
  local_path: z.string(),
  branch: z.string().nullable(),
  head_commit: z.string().nullable(),
  default_branch: z.string().nullable(),
  file_tree: z.array(z.string()),
  key_files: z.array(z.string()),
  symbols: z.array(z.object({
    path: z.string(),
    name: z.string(),
    kind: z.string()
  })),
  recent_commits: z.array(z.string()),
  diff_summary: z.string(),
  snapshot_path: z.string(),
  refreshed_at: z.string()
});
export type RepoSnapshot = z.infer<typeof RepoSnapshotSchema>;
