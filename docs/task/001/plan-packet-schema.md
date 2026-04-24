# Appendix: Plan Packet Schema

Plan Mode is a moderated, structured planning workflow that runs multiple
LLMs across ordered rounds and produces a durable **Plan Packet**: a typed
JSON artifact persisted to SQLite and rendered to wiki.

This document defines:

- the round protocol
- participant roles
- output contracts per round
- the final Plan Packet schema
- persistence and versioning rules
- how plan packets convert to tasks

## Round Protocol

Plan Mode always runs these rounds in order. Rounds advance when the
moderator confirms the round is complete (sufficient input collected, no
blocking clarifications pending). User can intervene, pause, or abort at
any round boundary.

| # | Round | Purpose | Moderator action |
|---|---|---|---|
| 1 | **Context** | Ground all participants in the same facts | Moderator assembles workspace context (wiki refs, repo snapshot, attachments). Participants acknowledge or ask clarifying questions. |
| 2 | **Proposal** | Each participant proposes an approach | Moderator prompts each participant with the same question. Responses collected in parallel. |
| 3 | **Critique** | Each participant critiques others' proposals | Cross-review, flag risks and gaps. |
| 4 | **Convergence** | Merge, eliminate dominated options, identify the best direction | Moderator synthesizes critiqued proposals into 1–3 candidate directions. Participants vote with reasoning. |
| 5 | **Decision** | Produce the final Plan Packet | Moderator writes the canonical plan, citing participant contributions. User approves, requests revision, or aborts. |

## Convergence Policy (per workspace)

Plan Mode supports three policies for resolving disagreement among
participants at Round 4. Policy is a workspace-scope preference
(falls back to global). Default: `consensus`.

| Policy | Behavior |
|---|---|
| `consensus` *(default)* | Moderator requires participants to align on a single top candidate. If they don't, the Moderator surfaces the disagreement to the user as a clarifying question. |
| `coordinator_decides` | Moderator picks a direction even when critics dissent. Dissent is recorded in `plan_packet.risks` and in round transcripts so it's auditable. Matches the ARIA-style "coordinator + critics" pattern where the coordinator holds executive authority. |
| `user_decides` | Moderator presents all ranked candidates as options; user picks. No automatic convergence. Best for unfamiliar domains where the user wants explicit control. |

Policy affects only Round 4. Rounds 1–3 behave identically across
policies. Round 5 writes the chosen direction with cited contributions
regardless.

## Participant Roles

Assigned at Plan Mode start from Brain Registry `plan_mode_participants`.
Default stereotyping (override per workspace):

| Role | Default brain tag | Responsibilities |
|---|---|---|
| **Moderator** | `moderator` + `reasoning` | Drives rounds, synthesizes, writes final packet. Exactly one. |
| **Requirements lead** | `reasoning` | Edge cases, acceptance criteria, constraints. |
| **Implementation lead** | `worker` + `reasoning` | Execution realism, sequencing, build order. |
| **Challenger** | `challenger` or `alternative` | Aggressive pushback, alternatives, risks. |

At least Moderator + Implementation lead + one other. Maximum 5 participants.

## Round Input/Output Contracts

All round outputs are strict JSON, validated against Zod schemas.

### Round 1: Context

**Moderator input** to each participant:

```json
{
  "round": "context",
  "workspace_summary": "...",
  "attachments": [{"name": "...", "excerpt": "..."}],
  "repo_snapshot_ref": "...",
  "wiki_refs": [{"page": "...", "excerpt": "..."}],
  "question": "Acknowledge the context and list any clarifying questions."
}
```

**Participant output**:

```json
{
  "round": "context",
  "participant_id": "...",
  "acknowledged": true,
  "clarifying_questions": ["..."],
  "missing_context": ["..."]
}
```

If any participant returns clarifying questions, the moderator routes them to
the user before proceeding.

### Round 2: Proposal

**Moderator input**:

```json
{
  "round": "proposal",
  "question": "Propose a solution. Include approach, architecture sketch, risks, and estimated effort."
}
```

**Participant output**:

```json
{
  "round": "proposal",
  "participant_id": "...",
  "approach_name": "short label",
  "summary": "2–4 sentences",
  "architecture_sketch": "...",
  "sequence": ["step 1", "step 2", "..."],
  "risks": ["..."],
  "effort_estimate": "small | medium | large | xl",
  "assumptions": ["..."]
}
```

### Round 3: Critique

**Moderator input**: all proposal outputs, plus:

```json
{
  "round": "critique",
  "question": "Critique each other proposal. Identify gaps, flaws, and unaddressed risks. Be specific."
}
```

**Participant output**:

```json
{
  "round": "critique",
  "participant_id": "...",
  "reviews": [
    {
      "target_participant_id": "...",
      "strengths": ["..."],
      "weaknesses": ["..."],
      "questions": ["..."]
    }
  ]
}
```

### Round 4: Convergence

Behavior depends on `convergence_policy` (see above).

**Moderator** does pre-work: collapses proposals + critiques into 1–3
candidate directions. Then input:

```json
{
  "round": "convergence",
  "candidates": [
    {
      "candidate_id": "A",
      "summary": "...",
      "incorporates_from": ["participant_id", "..."],
      "open_questions": ["..."]
    }
  ],
  "question": "Rank the candidates and explain your top pick in one paragraph."
}
```

**Participant output**:

```json
{
  "round": "convergence",
  "participant_id": "...",
  "ranking": ["A", "B", "C"],
  "top_pick_rationale": "...",
  "remaining_concerns": ["..."]
}
```

### Round 5: Decision

**Moderator** produces the final Plan Packet (schema below). User is shown
the packet and must take one of:

- **Approve**: packet is persisted with status `approved`; tasks may be
  generated.
- **Revise**: user edits inline; moderator re-runs the decision round with
  the edits as authoritative.
- **Abort**: Plan Mode ends with packet status `aborted`.

## Plan Packet Schema

The canonical output persisted to SQLite and rendered to the workspace wiki.

```ts
type PlanPacket = {
  packet_id: string;             // uuid
  workspace_id: number;
  version: number;               // bumps on revision
  status: "draft" | "approved" | "superseded" | "aborted";
  title: string;
  summary: string;               // 1 paragraph
  goals: string[];
  non_goals: string[];
  constraints: string[];
  assumptions: string[];
  risks: Array<{ risk: string; likelihood: "low" | "med" | "high"; mitigation: string }>;
  open_questions: string[];
  architecture: {
    overview: string;
    components: Array<{ name: string; purpose: string }>;
    data_flow?: string;
  };
  phases: Array<{
    name: string;
    goal: string;
    deliverables: string[];
    dependencies: string[];      // phase names
  }>;
  tasks: Array<{
    title: string;
    description: string;
    acceptance_criteria: string[];
    assignee_hint: "claude" | "codex" | "either" | "human";
    phase: string;               // references phases[].name
    priority: "high" | "normal" | "low";
  }>;
  first_recommended_action: string;
  source: {
    participants: Array<{ brain_id: string; role: string }>;
    round_transcripts: string[]; // file refs in sessions/
    attachments_considered: string[];
  };
  approved_at?: string;
  approved_by: "user";
  supersedes?: string;           // prior packet_id
  created_at: string;
  updated_at: string;
};
```

## Persistence

- **SQLite**: `plan_packets` table (id, workspace_id, version, status, JSON
  blob of the packet, source_session_ids, timestamps).
- **Wiki**: rendered to `memory/workspaces/<slug>/wiki/plans/<packet_id>.md`
  as markdown (plan body + decision narrative). Auto-committed on approval.
- **Sessions directory**: full round transcripts saved to
  `sessions/<plan_session_id>/rounds/<N>-<round>.json`.

## Versioning

- Every revision increments `version`.
- Prior versions remain readable (never deleted).
- A packet can be **superseded** by a newer packet (`supersedes` points at
  the older `packet_id`). The wiki index reflects the active packet only;
  history is accessible via git log of the wiki page.

## Task Generation

Approved packets can generate tasks via `ward plan generate-tasks <packet_id>`
or a UI button:

- Each entry in `tasks[]` becomes a `task` row.
- `assignee_hint` sets the preferred worker for future delegation.
- `acceptance_criteria` is copied to a `task_contract` row.
- The task is linked back to `packet_id` so delegation inherits context.

## Simulated Mode (MVP for Task 006)

Plan Mode 006 ships with **simulated participants** by default. Real brains
plug in via the Brain Registry once Task 008 lands. Simulated mode:

- Deterministic, seed-controllable responses
- Enables UI and flow testing without API spend or CLI dependency
- Honors all schemas above so no downstream task changes when real brains
  are wired in

## Failure Handling

| Failure | Handling |
|---|---|
| Participant call fails | Moderator drops that participant for the round, notes it in Plan Packet `source` with `failed_participants` |
| Clarifying questions never resolved | Packet marked `draft`; Plan Mode paused until user answers |
| Moderator fails | Plan Mode pauses; router tries `budget_exceeded_fallback`; if still failing, aborts with explicit reason |
| User closes UI mid-round | State persisted; Plan Mode resumes on next open |

## Testing

- Round-protocol fixtures: known inputs produce schema-valid outputs.
- Simulated participants with scripted responses for deterministic tests.
- Contract tests validate Plan Packet schema on every write.
- Round transitions cannot skip rounds without an explicit abort.
