# Appendix: Task Workflow Model

WARD treats tasks as durable work objects, not chat threads. A task carries
scope, evidence, agent signals, approval gates, and final shipping state from
planning through release. Sessions and agents may come and go; the task remains
the routing anchor.

This model is the contract that Task 003 stores in SQLite and that the React
command center renders.

## Core Principles

1. **Task docs are the human-readable contract.** SQLite stores state and
   indexes, but task docs carry the full scope, acceptance criteria, evidence,
   risks, and shipping narrative.
2. **Transitions are explicit.** Every lifecycle change emits a task event and
   records who or what caused it.
3. **Approval gates are first-class.** WARD pauses at planning approval,
   scope expansion, failed QA, destructive actions, and external posting unless
   workspace policy allows automatic progression.
4. **Evidence beats confidence.** Agent claims do not advance a task unless the
   required artifact or evidence packet exists.
5. **Tasks can observe external work.** WARD can manage a task it launched or
   attach to work happening in Claude Code, Codex, GitHub, Linear, or another
   PM tool through `external_ref_json`.

## Task Identity

```ts
type WardTask = {
  id: string;                    // local stable id, e.g. "task_002"
  workspace_id: number;
  title: string;
  description: string;
  type: "epic" | "feature" | "bug" | "chore" | "research" | "release";
  priority: "low" | "medium" | "high" | "urgent";
  status: TaskStatus;
  lifecycle_phase: TaskPhase;
  source: "user" | "plan_mode" | "inbound" | "scheduler" | "external_sync";
  owner: "user" | "ward" | "external";
  autonomy_level: "strict" | "standard" | "lenient";
  task_doc_path?: string;
  evidence_packet_path?: string;
  plan_packet_id?: string;
  parent_task_id?: string;
  blocked_by_task_ids: string[];
  external_ref_json?: ExternalTaskRef;
  created_at: string;
  updated_at: string;
  completed_at?: string;
};

type ExternalTaskRef = {
  provider: "github" | "linear" | "jira" | "notion" | string;
  external_id: string;
  url?: string;
  sync_direction: "read_only" | "ward_to_external" | "external_to_ward" | "bidirectional";
  last_synced_at?: string;
};
```

`status` is the compact state shown in lists and filters. `lifecycle_phase`
keeps the UI and Orchestrator aligned with the active workflow stage.
`autonomy_level` uses the same cross-cutting policy vocabulary as the
Orchestrator, Harness, and MCP layers. Tasks default to the workspace's
effective autonomy level; task-specific changes are explicit overrides.
Manual pauses are represented by approval gates and `needs_user`, not by a
separate autonomy vocabulary.

## Lifecycle States

```ts
type TaskStatus =
  | "idea"
  | "planned"
  | "approved"
  | "queued"
  | "in_progress"
  | "needs_user"
  | "needs_work"
  | "blocked"
  | "ready_to_ship"
  | "shipped"
  | "done"
  | "canceled";

type TaskPhase =
  | "intake"
  | "planning"
  | "approval"
  | "implementation"
  | "quality_gate"
  | "testing"
  | "qa_supervision"
  | "documentation"
  | "reporting"
  | "shipping"
  | "closed";
```

| Status | Meaning | Typical phase |
|---|---|---|
| `idea` | Captured request with incomplete contract | `intake` |
| `planned` | Task doc exists, but user has not approved scope | `planning` |
| `approved` | Scope approved and ready for execution | `approval` |
| `queued` | Waiting for harness slot, dependency, or schedule | `implementation` |
| `in_progress` | An agent or observed external worker is active | any execution phase |
| `needs_user` | Waiting for human decision or permission | `approval` or active phase |
| `needs_work` | QA, supervisor, or review found actionable gaps | `implementation` |
| `blocked` | Cannot proceed without an external dependency or unavailable capability | any phase |
| `ready_to_ship` | Evidence, docs, and reporting are complete; external ship decision remains | `shipping` |
| `shipped` | PR/release/external handoff completed | `closed` |
| `done` | Local task complete without external shipping | `closed` |
| `canceled` | User or policy intentionally stopped the task | `closed` |

## Canonical Transition Graph

```txt
idea
  -> planned
  -> approved
  -> queued
  -> in_progress
  -> ready_to_ship
  -> shipped
  -> done

in_progress -> needs_user -> in_progress
in_progress -> needs_work -> queued | in_progress
in_progress -> blocked -> queued | canceled
ready_to_ship -> needs_user -> shipped | done
any non-terminal -> canceled
```

WARD may skip `queued` for immediately runnable work. WARD may also close a
small local task as `done` without `ready_to_ship` when no PR, release, or
external communication is required.

Illegal transitions are rejected at the domain service boundary and emitted as
`task.transition_rejected` for observability.

## Workflow Stages and Agents

| Phase | Primary actor | Required artifact before advancing |
|---|---|---|
| `intake` | User, inbound channel, scheduler, or Plan Mode | captured request |
| `planning` | Planning Agent (`/task`) | task doc with acceptance criteria and file plan |
| `approval` | User or policy | approval event or policy decision |
| `implementation` | Coding Agent (`/implement`) | changed files and implementation claims |
| `quality_gate` | Quality Gate Agent (`/simplify`) | quality-gate signal |
| `testing` | QA Agent (`/test`) | test report and raw evidence artifacts |
| `qa_supervision` | QA Supervisor | evidence critique and confidence result |
| `documentation` | Documentation Agent (`/document`) | docs diff or stale-doc note |
| `reporting` | Reporting Agent (`/ship`) | PR summary, release note, or handoff |
| `shipping` | User, GitHub MCP, release tool, or PM sync | PR/release/post result or local done decision |
| `closed` | Runtime | terminal event and final evidence packet |

A phase may run more than once. `needs_work` loops back to implementation with
preserved evidence and critique, not a fresh blank task.

## Approval Gates

```ts
type ApprovalGate = {
  id: string;
  task_id: string;
  gate_type:
    | "planning_scope"
    | "scope_expansion"
    | "destructive_action"
    | "external_network"
    | "external_post"
    | "secret_access"
    | "qa_failure"
    | "ship_decision";
  reason: string;
  requested_by: "orchestrator" | "agent" | "harness" | "mcp";
  status: "open" | "approved" | "rejected" | "expired";
  created_at: string;
  resolved_at?: string;
  resolution_note?: string;
};
```

Open gates set the task to `needs_user` unless the task is already `blocked`.
Resolving a gate returns the task to the phase that opened it, or to
`canceled` when rejected and no fallback exists.

Default gates:

- `planning_scope` after `/task` writes or materially changes a task doc
- `scope_expansion` when an agent wants to touch files, systems, or outcomes
  beyond the approved task doc
- `destructive_action`, `external_post`, and `secret_access` for safety
- `qa_failure` when QA Supervisor returns `fail`, `blocked`, or `needs_work`
- `ship_decision` before opening a PR, publishing a release, or sending an
  external client/status message

## Task Contract

Every executable task has a contract:

```ts
type TaskContract = {
  task_id: string;
  goal: string;
  constraints: string[];
  acceptance_criteria: Array<{
    id: string;
    statement: string;
    verification: "test" | "review" | "screenshot" | "log" | "manual";
    required: boolean;
  }>;
  file_plan: Array<{
    path: string;
    intent: "create" | "modify" | "delete" | "inspect";
    owner_agent?: string;
  }>;
  max_iterations: number;
  reporting_format: "pr" | "release_note" | "handoff" | "none";
};
```

The contract is generated from the task doc and can be edited by the user.
WARD treats the approved contract as the boundary for scope, test evidence,
and final reporting.

## Evidence and Exit Checks

A task can move to `ready_to_ship`, `shipped`, or `done` only when:

- all required acceptance criteria are `pass` or explicitly waived by the user
- the latest `TaskEvidencePacket.confidence.status` is `ready`
- the task doc has current implementation claims and open risks
- QA Supervisor has either passed the evidence or recorded a user-approved
  waiver
- docs/reporting requirements for the task are complete or intentionally
  skipped
- no blocking approval gates remain open

WARD may show an optimistic progress indicator, but terminal status always
comes from evidence and events.

## UI Surface

The React command center should expose tasks as a board plus detail view:

- task list filters by workspace, status, phase, priority, owner, and external
  provider
- phase timeline with events, agent signals, and approval gates
- acceptance criteria checklist with evidence links
- active harness/session panel when `in_progress`
- blocked/needs-user callout with approve/reject actions
- evidence drawer showing test reports, screenshots, traces, diffs, and PR
  metadata
- final ship panel for PR/release/handoff decisions

The UI reads task state from the Runtime API. It does not infer status from raw
agent prose.

## API Shape

MVP endpoints:

```txt
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/:id
PATCH  /api/tasks/:id
POST   /api/tasks/:id/transition
POST   /api/tasks/:id/approve
POST   /api/tasks/:id/reject
GET    /api/tasks/:id/events
GET    /api/tasks/:id/evidence
```

`POST /transition` validates the transition graph, writes the task row, emits a
task event, and returns the updated task. UI and CLI should prefer named
commands (`approve`, `reject`, `cancel`, `resume`) over writing raw status.

## Event Types

Task lifecycle events extend `event-taxonomy.md`:

| `event_type` | When | Payload |
|---|---|---|
| `task.created` | task row and optional doc created | `{task_id, source, title}` |
| `task.updated` | metadata or contract changed | `{task_id, changed_fields[]}` |
| `task.transitioned` | legal lifecycle transition | `{task_id, from_status, to_status, from_phase, to_phase, reason}` |
| `task.transition_rejected` | illegal transition attempted | `{task_id, from_status, requested_status, reason}` |
| `task.gate_opened` | approval gate created | `{task_id, gate_id, gate_type, reason}` |
| `task.gate_resolved` | approval gate approved/rejected | `{task_id, gate_id, decision}` |
| `task.evidence_attached` | evidence packet or artifact linked | `{task_id, artifact_ref, evidence_kind}` |
| `task.external_synced` | PM/repo external ref synced | `{task_id, provider, external_id, direction}` |

## SQLite Notes

Task 003 should keep task rows normalized enough for fast UI filters while
leaving large bodies in artifacts:

- `task`: compact identity, status, phase, priority, owner, external ref,
  timestamps
- `task_contract`: structured acceptance criteria, constraints, file plan,
  reporting format
- `task_gate`: open and historical approval gates
- `task_dependency`: parent/blocked-by relationships
- `task_artifact`: references to docs, evidence packets, diffs, screenshots,
  traces, PRs, and logs
- `session.task_id`: all harness sessions may attach to one task

Large evidence payloads stay in files and are referenced by path/checksum.

## External Sync

External systems do not replace WARD's lifecycle. They map into it:

| External signal | WARD effect |
|---|---|
| GitHub issue opened / Linear issue created | create or link task as `idea` or `planned` |
| Issue moved to ready | transition to `approved` if task contract exists |
| PR opened | attach PR artifact; usually `ready_to_ship` |
| CI failed | `needs_work` with failing check artifact |
| PR merged / release published | `shipped` |
| External task closed without WARD evidence | `needs_user` for reconciliation |

When sync direction is bidirectional, WARD writes compact status and artifact
links outward, but task docs and evidence packets remain the richer source of
truth.

## Relationship to Sessions and Agents

- A task can have many sessions.
- A session belongs to at most one task.
- Agents return `AgentSignal`s that can move a task only through the domain
  transition service.
- Harness lifecycle state (`initializing`, `testing`, `done`, etc.) is not task
  status. It is session-local signal that may inform task progress.
- Plan packets can create many tasks, but each task has one approved contract
  at a time.
