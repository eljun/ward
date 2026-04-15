---
description: Ask Ward to summarize the last long response he saved for later.
---

Ward stores the last long assistant response in state when he gives a short handoff instead of reading it aloud.

Steps:
1. Determine the WARD repo root from the location of this command file.
2. Run `python3 {ward_repo}/scripts/summary_request.py` from the current working directory.
3. If Ward says there is nothing queued for summary, tell the user that no long response is currently stored.

Notes:
- This command should summarize from the current project's WARD state file.
- The summary should be spoken by Ward, not rephrased by the assistant.
- After a successful summary, the stored `summary_offer_available` flag should be cleared.
