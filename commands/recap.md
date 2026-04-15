---
description: Sync session state from your tasks file. Reads In Progress, Planned, Ready to Ship, and Known Issues sections. Speaks your top priorities and updates state.json.
---

Read the tasks file for the current project at the path configured in ~/.ward/config.json.

Steps:
1. Load ~/.ward/config.json. Find the entry in `projects` whose key matches the current working directory.
2. If no matching project entry exists, ask the user to provide the path to their tasks file and offer to add it to config.
3. Resolve tasks_md_path relative to the project root (the cwd key in config).
4. If the argument "full" was passed, read the entire tasks file. Otherwise extract ONLY these sections: "## In Progress", "## Planned", "## Ready to Ship", "## Known Issues".
5. Run: python3 {ward_repo}/scripts/brain.py with event="recap", the extracted content in context, and mode="state" to generate updated state.json fields.
6. Determine the correct state file path:
   - If the current working directory matches a project in ~/.ward/config.json, write to ~/.ward/states/{safe_project_name}.json (lowercase, spaces to underscores).
   - Otherwise write to ~/.ward/state.json.
   Merge with existing state, always update last_active to today.
7. Run: python3 {ward_repo}/scripts/speak.py with a 1-2 sentence spoken summary of what was found — top priority, tasks in progress count, pending PRs if any.

Where {ward_repo} is the directory containing this commands/ folder.

Example spoken output:
"Synced. Six tasks in progress, Task 46 is your next HIGH priority, and two PRs still waiting to merge."

If the tasks file does not exist at the resolved path:
"Couldn't find the tasks file at that path. Check tasks_md_path in ~/.ward/config.json."
