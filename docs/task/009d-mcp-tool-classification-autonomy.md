# Task 009D: MCP Tool Classification and Autonomy Policy

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 009C
- Recommended Tier: `deep`

## Overview

Classify MCP tools and apply WARD's autonomy policy before any worker or
orchestrator can call them. This slice creates the decision layer only:
tool metadata, heuristic classification, explicit overrides, capability
profiles, per-run allowlist checks, and synthetic denial results. Actual
remote tool invocation remains in the next slice.

## Requirements

- Add MCP tool metadata and classification schemas.
- Classify tools as `read`, `write`, `destructive`, or `privileged`.
- Apply explicit config overrides from `ward_tool_class_overrides`.
- Implement heuristic classification for common tool names.
- Implement autonomy matrix from `docs/task/001/security-model.md`.
- Apply per-run `allowed_tools[]`.
- Add capability profile expansion:
  - `browser_qa`
  - `repo_hosting`
  - `deployment`
  - `database`
- Return structured permit/deny decisions.
- Emit or prepare `mcp.tool_denied` payloads for denied calls.
- Add CLI/API policy preview command for a tool/class/autonomy combination.

## Out of Scope

- Calling real MCP tools.
- Circuit breakers.
- Intervention approval UI.
- Persisting pending approval records.
- Browser QA evidence capture.

## Proposed File Changes

- `packages/core/src/mcp/index.ts` - Add tool metadata, policy decision, and
  capability profile schemas.
- `packages/memory/src/mcp-policy.ts` - Add classifier, profile expansion,
  and autonomy gate.
- `packages/memory/src/index.ts` - Export policy helpers.
- `apps/runtime/src/index.ts` - Add policy preview route.
- `apps/cli/src/main.ts` - Add `ward mcp policy`.
- `docs/task/009-mcp-connections.md` - Record slice notes.
- `TASKS.md` - Track 009D.

## Code Context

- `McpToolClassSchema` already exists in `packages/core/src/mcp/index.ts`.
- Harness launches already carry `allowed_tools` in
  `packages/core/src/harness/index.ts`.
- Stub harness already emits `mcp.tool_denied` for denied fake tool calls in
  `packages/harness/src/index.ts`; the new policy layer should align with
  that event shape.
- Autonomy levels are defined in `packages/core/src/schemas.ts`.

## Implementation Steps

1. Add policy decision schemas.
2. Implement deterministic tool-name classifier.
3. Implement override application from MCP server config.
4. Implement autonomy matrix.
5. Implement `allowed_tools[]` narrowing.
6. Add capability profile expansion helper.
7. Add CLI/API policy preview surface.
8. Add smoke checks for read/write/destructive/privileged decisions.
9. Update docs and task tracking.

## Acceptance Criteria

1. Tool names classify deterministically.
2. Explicit overrides beat heuristics.
3. `strict`, `standard`, and `lenient` autonomy decisions match the security
   model.
4. A missing per-run allowlist entry denies a tool even if autonomy allows
   its class.
5. Capability profiles expand to expected tool patterns.
6. Policy preview returns a structured decision and denial reason.
7. Typecheck/build/diff checks pass.

## Verification

- `bun run typecheck`
- `bun run build`
- `git diff --check`
- policy smoke for representative tools:
  - `repos.get` -> read
  - `issues.create` -> write
  - `repos.delete` -> destructive
  - `payments.transfer` -> privileged
- API/CLI smoke for allowed and denied decisions

