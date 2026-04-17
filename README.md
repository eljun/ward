# Ward

This repo is currently reset to a planning-first baseline for the Ward personal developer command center/orchestrator project.

Current canonical planning artifacts:

- [TASKS.md](/Users/eleazarjunsan/Code/Personal/ward/TASKS.md)
- [docs/task/001-personal-orchestrator-command-center.md](/Users/eleazarjunsan/Code/Personal/ward/docs/task/001-personal-orchestrator-command-center.md)

The previous Next.js scaffold has been intentionally removed. The repo now contains a Python baseline for the local runtime:

- `pyproject.toml`
- `src/ward/`
- SQLite bootstrap
- wiki memory bootstrap
- CLI entrypoint

## Quick Start

Use the CLI directly from the repo:

```bash
PYTHONPATH=src python3 -m ward --help
PYTHONPATH=src python3 -m ward init
PYTHONPATH=src python3 -m ward status
PYTHONPATH=src python3 -m ward create-workspace "Project X" --description "Planning sandbox"
```

By default the runtime writes to `./.ward/`. Override this with `WARD_HOME` or `--home`.

## Current Baseline

The current implementation provides:

- local runtime bootstrap
- SQLite operational state
- universal wiki bootstrap
- workspace wiki bootstrap
- workspace creation and listing

It does not yet provide:

- web UI
- plan mode
- agent harnesses
- live session capture
- model integrations
