# Orb Context

WARD's orb chat builds a system prompt from two parts:

1. A persona header. By default this identifies WARD as the user's
   local peer developer and keeps replies short.
2. A bounded state context block. By default this includes the active
   workspace, top open tasks, recent sessions, today's date, profile
   tone, and a read-only safety note.

The runtime reads global preferences before composing each orb prompt:

| Preference | Default |
|---|---|
| `orb.system_prompt_override` | `""` |
| `orb.context.include_workspaces` | `true` |
| `orb.context.include_tasks` | `true` |
| `orb.context.include_sessions` | `true` |
| `orb.context.include_wiki` | `false` |
| `orb.context.token_budget` | `800` |

Token cost is estimated with `Math.ceil(text.length / 4)`. The prompt
builder greedily fills blocks in priority order and truncates the next
block that would overflow the budget. Workspace and date context are
kept ahead of larger task/session blocks so low budgets still preserve
basic situational awareness.

When session context is disabled, the prompt includes an explicit note
that session details are unavailable. This lets the model answer
session questions honestly instead of guessing from stale history.
