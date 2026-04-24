# Task 002: Runtime Skeleton

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `high`
- Depends on: 001

## Summary

Lay the foundation for every later task. Replace the Python baseline with a
Bun + TypeScript monorepo. Ship a runnable daemon + CLI with auth,
single-instance guard, migration framework, structured logging, `ward doctor`,
and a PTY smoke test. No feature surface yet — this task exists so 003–012
all have a solid runtime to build on.

## In Scope

- Delete the Python `src/ward/` baseline and `pyproject.toml`.
- Initialize Bun + TypeScript monorepo at repo root:
  - `apps/runtime` — Bun daemon (HTTP + SSE + WebSocket stubs)
  - `apps/cli` — `ward` command, auto-starts daemon
  - `apps/ui` — Vite shell (empty page, verifies the static-serving path)
  - `packages/core` — shared Zod schemas and types from 001 appendices
  - `packages/memory` — SQLite connection + migration runner
- Daemon bootstraps `~/.ward/` layout per 001:
  - `~/.ward/run/ward.pid` (flock-based single-instance)
  - `~/.ward/auth/device.key` (mode 0600, generated on init)
  - `~/.ward/logs/ward-YYYY-MM-DD.ndjson` (rotating)
  - `~/.ward/cache/` (empty, used by 005)
  - `~/.ward/sessions/` (empty, used by 007)
  - `~/.ward/secrets/` (fallback, mode 0700)
- HTTP server on `127.0.0.1:<port>`, port auto-selected then persisted.
- Bearer auth middleware: every request requires `Authorization: Bearer
  <device-token>`.
- Migration runner reads numbered files in `packages/memory/migrations/` and
  tracks applied versions in `schema_version` table.
- Structured NDJSON logger with trace-id propagation.
- `ward doctor`:
  - port free
  - PID lock state
  - device token present and `0600`
  - schema version current
  - keychain reachable (stubbed for MVP — actual keychain lands in 009)
  - `claude` and `codex` CLI detected on PATH (warning if missing)
  - PTY smoke: spawn a trivial PTY process and read output, verify
    `node-pty` native addon works
- CLI commands for this task:
  - `ward init` — creates `~/.ward/`, writes device token, runs migrations
  - `ward up` / `ward down` — explicit daemon control
  - `ward status` — daemon up/down, port, uptime, schema version
  - `ward doctor` — health checks above
  - `ward auth rotate` — new device token, propagates to CLI

## Out of Scope

- Any workspace / task / session features (lands in 003 and onward)
- MCP servers (lands in 009)
- Real brain adapters (lands in 008)
- UI beyond a health-check page

## Acceptance Criteria

1. `ward init` on a clean machine creates the full directory layout with
   correct permissions.
2. `ward up` starts the daemon; `ward status` shows it running.
3. Second `ward up` attempt fails with a clear single-instance error.
4. HTTP requests without the device token return 401. With the token,
   `GET /api/health` returns 200.
5. `ward doctor` prints a checklist with pass/fail per check.
6. PTY smoke test inside `ward doctor` passes on Linux and macOS.
7. Migration runner applies a seed migration and records its version.
8. Graceful shutdown flushes logs and releases the PID lock.
9. CLI cold start for `ward status` is under 200 ms on a warm machine.
10. No Python or Next.js references remain in the repo.

## Deliverables

- Bun + TypeScript monorepo scaffold
- `packages/core` with Zod types imported from 001 appendix schemas
- `packages/memory` with migration runner
- `apps/runtime` daemon + `apps/cli` CLI
- `ward doctor` passing locally
- README updated with install + first-run steps

## Risks

- `node-pty` compilation failure on some machines: mitigate with a clear
  error message in `ward doctor` and fallback-to-headless policy in later
  tasks.
- Port collisions: auto-retry with a configurable range, persist chosen
  port in config.
