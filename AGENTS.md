# Bun + TypeScript Baseline

This repo is a **Bun + TypeScript** local-first orchestrator project. The
runtime, CLI, and UI all run on Bun. SQLite via `bun:sqlite`. UI built with
Vite — no Next.js, no SSR framework.

The legacy Python baseline has been removed. New work targets the Bun + TS
monorepo described in the planning docs.

Keep the runtime local-first, single-user, and aligned with the planning
docs in `TASKS.md` and `docs/task/`. The canonical tech plan lives in
[docs/task/001-personal-orchestrator-command-center.md](docs/task/001-personal-orchestrator-command-center.md)
with appendices under [docs/task/001/](docs/task/001/).
