# Configure Orb Context

Open Settings, then use the Standard tab's **Orb context** card.

Use **System instruction** to override how WARD introduces itself.
Leave it blank to use the default peer-developer prompt. Saving this
field persists `orb.system_prompt_override`.

Use **Include in context** to choose which state WARD can see in chat:
workspace/repo, top open tasks, recent sessions, and experimental wiki
snippets. Toggles save immediately.

Use **Token budget** to trade detail for speed. Smaller budgets make the
local model prefill less context; larger budgets give it more task and
session detail. The live token estimate updates while typing.

Use **Test reply** to preview the current unsaved system instruction
against the local brain without persisting the textarea.

Use **Reset to default** to write all six orb-context preferences back
to their defaults.
