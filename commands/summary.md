---
description: Ask Ward to summarize the last long response he saved for later.
---

Ward stores the last long assistant response in state when he gives a short handoff instead of reading it aloud.

Steps:
1. Run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/summary_request.py` from the current working directory.
2. If Ward says there is nothing queued for summary, tell the user that no long response is currently stored.

`${CLAUDE_PLUGIN_ROOT}` is expanded by Claude Code to the installed plugin directory.

Notes:
- This command should summarize from the current project's WARD state file.
- The summary should be spoken by Ward, not rephrased by the assistant.
- After a successful summary, the stored `summary_offer_available` flag should be cleared.
