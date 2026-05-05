# Task 009B: Secrets and macOS Keychain Fallback

- Status: `done`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 009A
- Recommended Tier: `balanced`

## Overview

Add WARD's secret management foundation for MCP connections. Secrets are
referenced from config as `secret://<name>`, stored outside SQLite/wiki/logs,
listed without values, and resolved only when WARD writes the private session
overlay consumed by a worker.

## Requirements

- Add secret schemas and backend status contracts.
- Prefer macOS Keychain through the `security` CLI.
- Support a file fallback under `~/.ward/secrets/` with mode `0600`.
- Allow `WARD_SECRET_BACKEND=file|keychain` for deterministic testing.
- Add global and workspace secret scopes.
- Implement workspace-to-global fallback for `secret://<name>`.
- Add `ward secrets list|set|unset|rotate`.
- Add API routes for the same operations.
- Update `ward doctor` to report the active secrets backend.
- Resolve `secret://` references in MCP session overlays.

## Out of Scope

- Linux Secret Service / Windows Credential Manager native adapters.
- Restarting live MCP servers on rotate; server lifecycle lands in a later
  Task 009 slice.
- UI for secret management.
- Secret-leak CI scan.

## Implementation Notes

### What Changed

- Added secret schemas for scoped values, index entries, and backend status.
- Added a secrets repository with macOS Keychain default and a file fallback.
- Added a names-only secret index at `~/.ward/secrets/index.json`.
- Added CLI/API secret set, list, unset, and rotate operations.
- Added `--stdin` support for CLI set/rotate so users can avoid shell history.
- Updated MCP session overlay generation to resolve `secret://` references in
  env and headers at launch time.
- Updated `ward doctor` to report the selected secret backend.

### Files Changed

- `packages/core/src/mcp/index.ts` - Adds secret schemas and backend status.
- `packages/memory/src/secrets.ts` - Adds backend selection, keychain/file
  storage, index handling, scoped fallback, and resolver helpers.
- `packages/memory/src/index.ts` - Exports secrets helpers.
- `packages/memory/src/mcp.ts` - Resolves MCP env/header secret references
  before writing session overlays.
- `packages/memory/src/sessions.ts` - Writes MCP overlays with mode `0600`.
- `apps/runtime/src/index.ts` - Adds `/api/secrets` routes.
- `apps/cli/src/main.ts` - Adds `ward secrets` and doctor backend reporting.
- `TASKS.md` - Tracks 009B completion and next slice.

### Deviations From Plan

- The smoke run used `WARD_SECRET_BACKEND=file` to avoid storing fake values
  in the user's real macOS Keychain.
- `ward secrets rotate` updates storage and the secret index now, but live
  MCP server restarts are deferred until the MCP lifecycle slice exists.
- Non-macOS native secret adapters are deferred; file fallback is available.

### Verification Run

- `bun run typecheck` - PASS
- `WARD_HOME=/tmp/ward-task009b-smoke WARD_SECRET_BACKEND=file bun run ward --json init` - PASS
- `WARD_HOME=/tmp/ward-task009b-smoke WARD_SECRET_BACKEND=file bun run ward --json doctor` - PASS (`secrets_backend` reports file forced)
- `WARD_HOME=/tmp/ward-task009b-smoke WARD_SECRET_BACKEND=file bun run ward --json create-workspace "Secrets Smoke" --description "Secrets verification" --repo /Users/eleazarjunsan/Code/Personal/ward` - PASS
- `ward secrets set gh-token --value global-secret` - PASS
- `ward secrets set gh-token --scope workspace --workspace secrets-smoke --value workspace-secret` - PASS
- `ward secrets list` - PASS (names and metadata only; no secret values)
- `ward mcp add github --scope workspace --workspace secrets-smoke --command workspace-gh --env GITHUB_TOKEN=secret://gh-token` - PASS
- `ward session launch secrets-smoke --scenario default --goal "Verify secret overlay resolution"` - PASS
- generated session overlay resolved `GITHUB_TOKEN` from workspace secret - PASS
- `ward session show session_2081ee50a9f04af2` - PASS (`done`)
- `ward secrets rotate gh-token --scope workspace --workspace secrets-smoke --value rotated-secret` - PASS
- second generated session overlay used the rotated workspace secret - PASS
- `ward secrets unset gh-token --scope workspace --workspace secrets-smoke` - PASS
- `ward secrets list --scope workspace --workspace secrets-smoke` - PASS (empty)
- third generated session overlay fell back to the global secret - PASS
- fallback secret files and index use mode `0600` - PASS
- `WARD_HOME=/tmp/ward-task009b-smoke WARD_SECRET_BACKEND=file bun run ward --json down` - PASS
- `bun run build` - PASS

## Acceptance Criteria

1. `ward secrets set/list/unset/rotate` works for global scope.
2. `ward secrets set/list/unset/rotate` works for workspace scope.
3. File fallback stores values outside SQLite/wiki and keeps files at `0600`.
4. `ward doctor` reports the active backend.
5. MCP session overlays resolve workspace secrets before global fallback.
6. Secret values are not returned by `ward secrets list`.
7. Typecheck and production build pass.
