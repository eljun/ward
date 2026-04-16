---
description: Register the current project in ~/.ward/config.json so WARD can track it automatically.
---

Initialize WARD for the current project without hand-editing the global config.

Steps:
1. Run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/init_project.py` from the current working directory.
2. If the project is already configured, tell the user the existing mapping and mention `--force` if they want to replace it.
3. After success, tell the user to run `/recap` once in this project.

Defaults used by the script:
- `project_name` defaults to a cleaned-up version of the current directory name
- `tasks_md_path` defaults to `TASKS.md` if present, otherwise `tasks.md`, otherwise `docs/TASKS.md`, otherwise `TASKS.md`

Optional CLI usage outside the slash command:
`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/init_project.py --name "My Project" --tasks docs/TASKS.md`

`${CLAUDE_PLUGIN_ROOT}` is expanded by Claude Code to the installed plugin directory.
