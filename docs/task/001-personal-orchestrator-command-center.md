# Task 1: Personal Developer Command Center and Orchestrator Integration

- Status: `in_progress`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`

## Summary

Build this app as a local-first, single-user developer command center. The product should help one developer see all active work, recap recent sessions, plan new projects with multiple LLMs, delegate work to agents like Codex and Claude, and resume work quickly the next day.

The architecture should be deployment-agnostic, but MVP remains local and personal. The system should support both a browser-based control surface and a local runtime that owns workspaces, memory, session state, and agent harnesses.

## Product Framing

### In Scope

- Single-user developer command center
- Local-first runtime with local storage
- Workspace overview and daily recap
- Plan Mode for moderated multi-LLM planning discussions
- Wiki-first memory for universal and workspace-specific knowledge
- Agent delegation contracts for Codex, Claude, and future workers
- Visible and headless harness modes
- Learning through structured outcomes, playbooks, and preferences

### Out of Scope for MVP

- Team accounts, org roles, or shared permissions
- SaaS multi-tenancy
- Production deployment workflows
- Fine-tuning models
- Fully autonomous background execution without approval
- Complex cloud sync

## User Problems

The product should solve these recurring problems:

1. Starting the day requires reconstructing context from memory, terminals, repo history, and scattered notes.
2. Planning new work is weak when done in a single-threaded chat without structured debate or durable planning artifacts.
3. Agent work is hard to observe, compare, and resume cleanly.
4. Long-term learning is lost in chat history instead of becoming reusable workflows and preferences.
5. Context retrieval should not depend on expensive, fragile ingestion and embedding pipelines for MVP.

## Core User Workflows

### 1. Morning Resume

The developer opens the app and sees:

- active workspaces
- recent sessions
- current branch and changed files per workspace
- blockers
- suggested next action
- running or paused agent sessions

The developer can then ask:

- "What did we do yesterday?"
- "What should I resume first?"
- "Summarize all open work."

### 2. Create New Workspace

The developer creates a workspace for a new project or initiative, attaches one or more source documents, and starts Plan Mode.

### 3. Plan Mode

The orchestrator acts as moderator while selected models such as Claude, Codex, and Grok participate in structured planning rounds:

- context round
- proposal round
- critique round
- convergence round
- decision round

The output becomes a durable plan packet and is written into the workspace wiki and state store.

### 4. Delegate Work

The developer asks the orchestrator to send a task to a worker. The orchestrator creates a task contract, selects a harness mode, launches the worker, and tracks live status.

### 5. End of Day Handoff

The system stores a concise handoff covering:

- what happened
- what changed
- decisions made
- blockers
- next steps

## Architecture Overview

### High-Level Components

1. `Workspace UI`
   - Browser-based command center
   - Shows overview, workspaces, plan mode, sessions, and memory

2. `Main Orchestrator`
   - Handles user requests
   - Builds context packets
   - Chooses workflows
   - Delegates to workers
   - Synthesizes final answers

3. `Workspace Graph`
   - Source of truth for workspaces, tasks, sessions, linked repos, attachments, and status

4. `Operational State Store`
   - SQLite-backed tables for tasks, sessions, live events, outcomes, and preferences

5. `Wiki Memory Layer`
   - Universal wiki for cross-project memory
   - Workspace wiki for project-specific compiled knowledge
   - Raw source documents remain immutable

6. `Agent Harnesses`
   - Wrappers for Codex, Claude, QA, and future workers
   - Support visible PTY sessions and headless sessions

7. `Live Event Pipeline`
   - Captures harness status, terminal output summaries, file changes, and session milestones

## Memory and Context Strategy

The system should not rely on raw RAG against all historical documents as its primary memory model. Instead it should use a hybrid:

### Raw Sources

- attached documents
- task docs
- transcripts
- repo-derived notes
- manual notes

These are immutable inputs.

### Compiled Wiki Memory

Following the LLM Wiki pattern, the system maintains:

- `memory/universal/`
  - preferences
  - playbooks
  - routing heuristics
  - recurring workflows

- `memory/workspaces/{slug}/wiki/`
  - overview
  - goals
  - constraints
  - architecture
  - decisions
  - blockers
  - session summaries
  - plan packets

- required support files:
  - `index.md`
  - `log.md`
  - schema/instructions file for wiki conventions

### Operational State

Use SQLite for:

- workspaces
- tasks
- sessions
- session events
- attachments
- plans
- outcomes
- learned preferences
- routing statistics

### Context Packet Assembly

When the orchestrator answers a request, it should build a compact packet from:

- live workspace state
- latest session summary
- top relevant wiki pages
- active blockers
- current task contract if any
- personal preferences relevant to the request

This packet should be model-agnostic and passed to whichever brain is selected.

## Learning Model

The system should learn through state and memory, not daily fine-tuning.

### Learning Inputs

- accepted or rejected outputs
- routing success by task type
- repeated user overrides
- failed delegations
- recurring planning patterns

### Learning Outputs

- updated playbooks
- updated preferences
- improved routing heuristics
- stronger task contract templates
- reusable project templates

### Rule

Separate:

- user-approved preferences
- inferred heuristics

Every learned rule should remain inspectable and reversible.

## Agent Harness Model

The harness is the runtime wrapper around each worker. It should standardize:

- launch method
- working directory
- injected instructions
- attached context packet
- visibility mode
- event reporting
- artifact capture

### Harness Modes

#### Visible

- PTY-backed session
- streamable to UI
- suitable for Codex and Claude implementation work
- user can observe and later take over

#### Headless

- background execution
- event summaries only
- suitable for QA, summarization, indexing, and utility tasks

### Harness Contract

Each worker launch should include:

- workspace id
- task id
- repo path
- role
- task contract
- allowed tools
- reporting format

## Plan Mode Design

Plan Mode should be a structured planning room, not a noisy group chat.

### Roles

- `Main orchestrator`
  - moderator
  - asks follow-up questions
  - tracks disagreements
  - writes final synthesis

- `Claude`
  - requirements and edge cases

- `Codex`
  - implementation realism and execution sequencing

- `Grok` or other challenger model
  - alternative ideas and critical pushback

### Planning Rounds

1. Context round
2. Proposal round
3. Critique round
4. Convergence round
5. Decision round

### Plan Mode Output

Produce a structured plan packet containing:

- project summary
- goals
- constraints
- assumptions
- risks
- open questions
- proposed architecture
- phased implementation plan
- task breakdown
- recommended first action

## Proposed UI Surface

### Primary Screens

1. `Overview`
   - daily brief
   - active workspaces
   - running sessions
   - recent handoffs

2. `Workspace Detail`
   - overview
   - linked repos
   - tasks
   - recent sessions
   - wiki summary
   - next actions

3. `Plan Mode`
   - moderated discussion thread
   - planning stage indicator
   - live synthesis panel
   - attachments

4. `Sessions`
   - active and past agent sessions
   - visible terminal view when applicable
   - status and artifacts

5. `Memory`
   - universal wiki
   - workspace wiki
   - search over wiki and operational state

### Initial Routes

- `/`
- `/workspaces`
- `/workspaces/[workspaceId]`
- `/workspaces/[workspaceId]/plan`
- `/sessions`
- `/sessions/[sessionId]`
- `/memory`

## Proposed Data Model

### Core Entities

- `workspace`
  - id, name, slug, description, status

- `workspace_repo`
  - id, workspace_id, local_path, branch, is_primary

- `attachment`
  - id, workspace_id, kind, file_path, source_type

- `task`
  - id, workspace_id, title, status, type, priority, assignee_kind

- `task_contract`
  - id, task_id, goal, constraints, acceptance_criteria, reporting_format

- `session`
  - id, workspace_id, task_id, agent_kind, mode, status, started_at, ended_at

- `session_event`
  - id, session_id, event_type, payload_json, created_at

- `plan_packet`
  - id, workspace_id, version, summary, status, source_session_ids

- `memory_record`
  - id, scope, workspace_id, type, title, body, confidence, source_refs

- `outcome_record`
  - id, task_id, session_id, outcome, failure_reason, accepted, notes

- `preference_record`
  - id, scope, key, value_json, source, confidence

- `playbook`
  - id, name, trigger_type, steps_json, confidence

## Storage Boundaries

### SQLite Owns

- all operational state
- task and session lifecycle
- plans and outcomes
- learned preferences and routing metadata

### Wiki Owns

- human-readable compiled memory
- durable knowledge summaries
- plan synthesis
- architecture notes
- project-level decision narratives

### Raw Files Own

- attachments
- imported transcripts
- original documents

## Technical Phases

### Phase 0: Planning Foundation

- Create task tracking and docs
- Confirm product boundaries
- Freeze MVP and non-goals
- Define workspace and memory conventions

### Phase 1: Core Workspace and State

- Add app shell and navigation
- Add workspace creation and listing
- Add SQLite schema and repository layer
- Add attachment intake

### Phase 2: Wiki-First Memory

- Create universal and workspace wiki directories
- Define wiki schema and page conventions
- Generate `index.md` and `log.md`
- Add simple local search over wiki and state

### Phase 3: Overview and Handoff

- Build dashboard overview
- Add session summaries, blockers, and next-step cards
- Add end-of-session handoff writer

### Phase 4: Plan Mode

- Add planning room UI
- Add planning rounds and moderator workflow
- Persist plan packets into SQLite and wiki
- Generate tasks from approved plans

### Phase 5: Harness Layer

- Add visible PTY harness abstraction
- Add headless harness abstraction
- Add session event stream and status model
- Start with mocked or stubbed workers before real agent integrations

### Phase 6: Real Agent Integrations

- Add Codex harness adapter
- Add Claude harness adapter
- Add worker task contract injection
- Capture live status and artifacts

### Phase 7: Learning and Playbooks

- Capture outcomes and overrides
- Build routing heuristics
- Add reusable playbooks and morning recommendations

## Key Technical Decisions

### 1. Deployment Strategy

Build local-first but keep boundaries clean enough for future Docker packaging. Avoid hardcoding localhost assumptions into orchestrator internals.

### 2. Search Strategy

Start with:

- wiki index
- SQLite queries
- full-text search

Delay embeddings until search quality is demonstrably insufficient.

### 3. Agent Brain Strategy

Keep the system brain-agnostic:

- orchestrator contracts should be structured
- task contracts should be explicit
- context packets should be vendor-neutral

### 4. UI Strategy

Use the browser as the control surface, while the runtime remains local and stateful.

### 5. Framework Constraint

Before implementing Next.js behavior, read the relevant guide in `node_modules/next/dist/docs/` because this project uses a newer Next.js version with breaking changes relative to older assumptions.

## Risks and Open Questions

### Risks

- Plan Mode may become noisy without strict moderation
- Harness capture may be brittle if upstream CLI behavior changes
- Wiki quality may degrade without conventions and lint passes
- Over-automation may reduce trust
- Local file and secret handling needs careful redaction rules

### Open Questions

1. What is the first supported attachment type set for MVP?
2. Should workspace repos be single-repo first, or support multiple repos immediately?
3. Should Plan Mode run with actual external models first, or with simulated adapters until the product shell is stable?
4. What exact event granularity is necessary before real harness integrations begin?
5. Should morning briefing be generated on app open, or lazily when requested?

## Acceptance Criteria

This task is complete when:

1. The app can create and display workspaces with metadata and attachments.
2. The app stores operational state in SQLite and compiled memory in a local wiki structure.
3. The overview screen can show a useful daily brief from stored state.
4. Plan Mode can ingest attachments, run a structured planning workflow, and save a plan packet.
5. The system can create task contracts from approved plans.
6. The system defines a stable harness abstraction supporting visible and headless modes.
7. The implementation remains single-user and local-first for MVP.

## Recommended Next Steps

1. Review and approve this task plan.
2. Start implementation with Phase 1 and Phase 2 together:
   - workspace state
   - SQLite schema
   - wiki memory directories and conventions
3. Build the overview UI before live agent integrations.
4. Delay real Codex and Claude harness integrations until the command-center shell and state model are stable.
