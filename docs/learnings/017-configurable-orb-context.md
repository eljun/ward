# Task 017 Retrospective

## Plan Vs Reality

- The preference-backed runtime prompt and Settings card matched the
  task plan.
- Verification showed that simply including workspace context did not
  guarantee the local model would name the workspace in a work
  recommendation. The prompt now says that explicitly.

## Quality Gate Findings

- Date context needed to be earlier in the budget order so low budgets
  keep workspace and date before larger task/session blocks.
- Disabling session context works better when the model sees an explicit
  "session details unavailable" note instead of a silent omission.

## Verification Findings

- Local Ollama cold load can exceed the 15 s test-reply timeout. A warm
  retry verified the endpoint shape and unsaved `system_prompt` preview.
- Browser verification caught the real Settings surface: Orb context
  card, live token estimate, toggles, Reset, and Test reply controls.

## Reusable Lessons

- For local models, do not rely on context presence alone when an
  acceptance criterion requires a specific answer shape. Add direct,
  narrow instruction for the required behavior.
- Context toggles should communicate absence as well as presence when
  the user may ask about a disabled category.
