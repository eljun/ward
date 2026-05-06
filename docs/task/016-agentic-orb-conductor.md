# Task 016: Agentic Orb Conductor

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `medium`
- Depends on: 014, 015
- Recommended Tier: `deep`

## Overview

Make the WARD orb chat understand multi-step requests like
"Add a task X for project Y and assign it to Claude Code" and execute
them as a coordinated chain — create the task, launch a session, track
progress, and report back with a final summary. The user's framing:

> "I think this makes the orb understand context eg: 'Add new X for
> project X and assigned assigned to Claude/Codex' orb then analysis
> and create the task, session, and assignment to harness. Gets back
> with an initial report, keeps track on progress."

Today the orb chat does:

- A small nav escape hatch (014).
- A single streaming reply from the local brain.

This task adds an **action layer** that can chain WARD API calls based
on parsed intent, with the user always informed and able to interrupt.

## Goals

- Parse natural-language requests into a structured plan
  (`{ steps: [{ kind, args }] }`).
- Execute the plan through existing WARD endpoints with explicit
  confirmation for destructive or expensive steps.
- Stream progress back into the orb transcript while the chain runs.
- Report a final summary with links to the artifacts created
  (task ID, session ID, etc.).

## Sketch of the action vocabulary (v1)

| Action | Maps to | Confirmation |
|---|---|---|
| `create_task` | `POST /api/tasks` | none |
| `update_task` | `PATCH /api/tasks/:id` | none |
| `launch_session` | `POST /api/sessions` | confirm by default |
| `attach_file` | `POST /api/workspaces/:slug/attachments` | none |
| `switch_workspace` | client-side | none |
| `read_overview` | `GET /api/overview` | none |
| `read_session` | `GET /api/sessions/:id` | none |

Add only what's needed for the v1 example: create_task, launch_session,
read_session.

## Approach

Two viable paths; pick during implementation:

1. **JSON-mode reply** — Ask Gemma to output structured JSON describing
   the plan. Validate with Zod, execute, report. Lower latency, simpler.
2. **Tool calling** — Use the brain's tool-calling protocol to expose
   each action as a function. Cleaner conceptually but Gemma's tool
   support is uneven and requires more infra.

Recommendation: start with JSON-mode reply. If the model misbehaves,
add a second-pass validator and retry once before falling back to a
plain conversational reply.

## Scope (rough — will be tightened during planning)

- New endpoint `POST /api/orb/conductor` that accepts a message and
  optionally executes a plan; or fold this into `/api/orb/chat/stream`
  with a `mode: "conductor"` flag.
- A small system prompt addendum that lists the action vocabulary,
  explains when to act vs. converse, and forbids hallucinating IDs.
- A confirmation flow surfaced in the orb transcript: "I will create
  task X and launch a Claude Code session. Proceed? [Yes / Cancel]".
- A progress feed back into the transcript as each step completes.

## Out of Scope (this task)

- Generalized tool-use across all brains (Claude/Codex sessions already
  have their own tool surfaces).
- Persistent multi-turn agent memory beyond the existing transcript.
- Speech-driven action triggering (microphone input).

## Rough acceptance idea

Typing `Add a task "Add a /health endpoint" to project brief and assign
to Claude Code` results in:

1. The orb confirms understanding and lists the planned steps.
2. After confirmation, a task is created, a session is launched, and
   the orb posts back-to-back updates as each step completes.
3. The session's progress is visible without leaving the home view.

## Notes

This task is currently a **stub**. Detailed scope, file changes,
implementation steps, and acceptance criteria will be drafted when
task 015 is shipping and we have hands-on feel for the new orb shell.
