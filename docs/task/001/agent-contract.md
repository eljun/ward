# Appendix: Agent Contract

WARD agents are bounded specialists coordinated by the Orchestrator Brain.
They are not always-running personas and they do not share hidden LLM
context. Each agent receives a compact context packet, performs one domain
job, writes durable artifacts, and returns a small structured signal.

This contract lets WARD add future agents without bloating the main
orchestrator context or coupling the system to any single coding harness.

## Core Principle

If WARD needs to remember it, the agent writes it to a durable artifact.

Private model context is allowed inside a harness session, but it is never a
source of truth. WARD trusts:

- `TASKS.md`
- `docs/task/*.md`
- `docs/testing/*.md`
- `docs/features/*.md`
- `docs/guides/*.md`
- `LEARNINGS.md`
- git diff / commits / PR metadata
- session events
- screenshots, traces, logs, and evidence packets

This mirrors the existing `workflow-skills` pattern: `/task`,
`/implement`, `/simplify`, `/test`, `/document`, `/ship`, and `/release`
externalize their state into markdown and test artifacts. WARD can
orchestrate those skills because the handoff state is hard memory, not
conversation memory.

## Agent Manifest

Every built-in or third-party WARD agent declares:

```ts
type WardAgentManifest = {
  id: string;                         // "ward.qa", "ward.documentation", ...
  version: number;
  display_name: string;
  mission: string;
  phase:
    | "planning"
    | "implementation"
    | "quality_gate"
    | "testing"
    | "documentation"
    | "reporting"
    | "scheduling"
    | "communication"
    | "automation";
  backing_skill?: string;             // e.g. "/test", "/document"
  allowed_capabilities: CapabilityId[];
  reads: ArtifactRef[];
  writes: ArtifactRef[];
  output_schema: string;              // e.g. "qa_result.v1"
  memory_policy: "ephemeral" | "task" | "project";
  approval_required_for: ApprovalClass[];
};
```

Agents are registered through `AgentRegistry` (see `extension-seams.md`).
The Orchestrator Brain chooses an agent by phase, manifest capabilities,
workspace preferences, and current task state.

Shared reference types:

```ts
type ArtifactRef = {
  kind:
    | "task_doc"
    | "test_report"
    | "evidence_packet"
    | "screenshot"
    | "trace"
    | "log"
    | "diff"
    | "pr"
    | "wiki"
    | string;
  path?: string;
  url?: string;
  checksum?: string;
  redacted?: boolean;
};

type CapabilityId =
  | "shell_tests"
  | "browser_qa"
  | "repo_hosting"
  | "deployment"
  | "database"
  | "remote_channel"
  | string;

type ApprovalClass =
  | "destructive_action"
  | "external_network"
  | "external_post"
  | "secret_access"
  | "scope_expansion"
  | string;
```

## Context Packet

The Orchestrator compiles a small packet before invoking an agent:

```ts
type AgentContextPacket = {
  task_id: string | null;
  phase: WardAgentManifest["phase"];
  workspace_id: number;
  task_doc?: string;
  task_status?: string;
  requirements: string[];
  acceptance_criteria: string[];
  implementation_claims: string[];
  changed_files: string[];
  prior_signals: AgentSignal[];
  known_risks: string[];
  harness_artifacts: ArtifactRef[];
  requested_output_schema: string;
  trace_id: string;
};
```

The packet is derived from durable sources and warm cache. It excludes
unbounded chat history unless a summarized excerpt has already been written
to an artifact.

## Agent Signal

Every agent returns a small signal, suitable for the Orchestrator to keep in
context:

```ts
type AgentSignal = {
  agent_id: string;
  status: "pass" | "fail" | "needs_work" | "blocked" | "needs_approval" | "done";
  summary: string;
  artifacts: ArtifactRef[];
  risks: string[];
  next_recommended_agent?: string;
  trace_id: string;
};
```

The full details live in artifacts. The signal is the routing primitive.

## Evidence Packet

Task-level evidence is accumulated in a machine-readable file:

```ts
type TaskEvidencePacket = {
  task_id: string;
  source_docs: string[];
  implementation: {
    changed_files: string[];
    key_decisions: string[];
    implementation_claims: string[];
  };
  qa: {
    status: "pass" | "fail" | "partial" | "needs_work" | "blocked" | "not_run";
    tests_run: string[];
    acceptance_criteria_results: Array<{
      criterion: string;
      status: "pass" | "fail" | "partial" | "blocked";
      evidence: string;
    }>;
    screenshots: ArtifactRef[];
    console_errors: string[];
    network_errors: string[];
    harness_critique: string[];
  };
  docs: {
    updated_files: string[];
    stale_docs_found: string[];
  };
  reporting: {
    pr_summary?: string;
    release_note?: string;
  };
  confidence: {
    status: "ready" | "needs_work" | "blocked";
    reasons: string[];
  };
};
```

Default path:

```txt
~/.ward/workspaces/<workspace>/evidence/<task_id>.json
```

When a repo prefers checked-in task artifacts, WARD may additionally write a
sanitized copy under:

```txt
docs/task/<task_id>/evidence.json
```

## Required Task Doc Sections

WARD can work with existing task docs, but task docs are strongest when they
include stable sections:

```md
## WARD Metadata
## Agent Signals
## Implementation Claims
## QA Evidence
## Harness Critique
## Open Risks
```

These sections stay human-readable while giving WARD reliable anchors for
parsing and compaction.

## Built-In Agent Roles

| Agent | Backing skill | Mission | Primary output |
|---|---|---|---|
| Planning Agent | `/task` | Expand a request into a task doc, acceptance criteria, file plan, and review checkpoint | task doc + planned signal |
| Coding Agent | `/implement` | Implement the task or fix failed verification according to the task doc | patch + implementation claims |
| Quality Gate Agent | `/simplify` | Validate coding standards and plan deviations before full QA | quality-gate signal |
| QA Agent | `/test` | Execute acceptance tests through Playwright MCP or CI-mode Playwright scripts | test report + QA evidence |
| QA Supervisor | WARD-native | Critique whether the QA evidence is sufficient and whether harness claims are proven | harness critique + confidence |
| Documentation Agent | `/document` | Update user-facing and project documentation from task evidence | docs diff + stale-doc notes |
| Reporting Agent | `/ship` | Create PR-ready narrative, changelog draft, and release handoff | PR summary + risks |
| Scheduler Agent | WARD-native | Schedule follow-ups, stale branch checks, recurring QA, and reminders | trigger specs |
| Communication Agent | WARD-native | Draft or send messages over approved channels | outbound message artifacts |
| Automation Agent | WARD-native | Compose repeatable playbooks from existing agents and triggers | playbook run record |

MVP starts with Planning, Coding, Quality Gate, QA, QA Supervisor,
Documentation, and Reporting. Scheduler, Communication, and Automation can
be added later through the same manifest and signal contract.

## QA Supervisor Contract

The QA Supervisor does not replace `/test`. It reviews the evidence produced
by `/test`, the task doc, and the git diff.

Inputs:

- task requirements and acceptance criteria
- `/test` report from `docs/testing/*.md`
- task doc implementation notes
- changed files and git diff summary
- Playwright screenshots, traces, console errors, and network errors
- PR summary draft when available

Checks:

- every acceptance criterion has direct evidence
- happy path, error states, and edge cases are represented when relevant
- browser tests check behavior, not only page load
- console and network errors were inspected
- auth or email flows are not marked pass without verifying the external step
- CI scripts are kept when they provide future regression value
- task docs and PR summary match the actual diff
- HARNESS claims are supported by artifacts

Outputs:

- updated `TaskEvidencePacket.qa`
- `## Harness Critique` section in the task doc when issues exist
- `AgentSignal` with `pass`, `needs_work`, `fail`, or `blocked`
- recommended next agent (`document`, `implement`, or `human`)

The QA Supervisor can mark a task `needs_work` even when `/test` reports
PASS if the evidence is too thin.

## Workflow-Skills Bridge

WARD treats `workflow-skills` as an adapter family:

```txt
Me -> WARD -> /task harness -> task docs -> WARD approval checkpoint
Me -> WARD -> /implement -> /simplify -> /test -> QA Supervisor
WARD -> /document -> /ship -> human merge/release decision
```

The important handoff rule is that every skill writes an artifact before
WARD advances to the next phase. WARD may launch the skill itself, or it may
observe an externally run Claude Code / Codex session through
`AgentObserver`; either way, the durable files are the shared memory layer.

## Approval Checkpoints

WARD asks the user before advancing when:

- a new task plan has been created and needs scope approval
- a QA Supervisor result is `fail`, `blocked`, or `needs_work`
- docs or PR narrative materially differ from implementation evidence
- destructive actions, external posting, or remote communication are needed
- a harness asks to expand scope beyond the approved task doc

In auto mode, approval can be policy-driven, but the default is conservative:
task planning, failed QA, destructive actions, and external communications
pause for the user.
