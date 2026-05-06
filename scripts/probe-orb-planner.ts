#!/usr/bin/env bun
/**
 * Probe the conductor plan generator. Builds the same prompt the runtime
 * sends and checks whether gemma4:e2b emits a valid OrbPlan JSON.
 *
 * Run: bun scripts/probe-orb-planner.ts
 */

import { OrbPlanSchema } from "../packages/core/src/orb/index.ts";

const BASE = "http://127.0.0.1:11434/v1";
const MODEL = process.env.MODEL ?? "gemma4:e2b";

const FAKE_WORKSPACES = [
  { slug: "brief", name: "Brief" },
  { slug: "ward", name: "WARD" },
  { slug: "kwentalk", name: "Kwentalk" }
];
const FAKE_BRAINS = ["claude-code-cli", "codex-cli", "stub-worker"];
const FAKE_OPEN_TASKS: Array<{ id: string; slug: string; title: string }> = [
  { id: "task_abcd1234", slug: "ward", title: "Fix login bug" }
];

function composeOrbConductorPrompt(): string {
  const workspaceList = FAKE_WORKSPACES.map((w) => `- ${w.slug} (${w.name})`).join("\n");
  const brainList = FAKE_BRAINS.map((b) => `- ${b}`).join("\n");
  const taskList = FAKE_OPEN_TASKS.map((t) => `- ${t.id} [${t.slug}] ${t.title}`).join("\n");
  return `You are W.A.R.D's orb conductor. The user has asked you to perform a multi-step action.

You MUST reply with a single JSON object (no prose, no code fences) matching this schema:

{
  "intent": "<one short sentence summary>",
  "needs_confirmation": <true|false>,
  "steps": [
    { "kind": "create_task", "args": { "workspace_slug": "<slug>", "title": "<title>", "type": "feature|bug|chore|research", "priority": "low|medium|high|urgent", "description": "<optional>" } },
    { "kind": "launch_session", "args": { "workspace_slug": "<slug>", "task_ref": "$<step-number>.id", "brain_id": "<brain>", "mode": "headless|visible", "goal": "<concrete goal>" } },
    { "kind": "read_overview", "args": {} },
    { "kind": "read_session", "args": { "session_ref": "$<step-number>.session_id" } },
    { "kind": "read_workspace", "args": { "workspace_slug": "<slug>" } }
  ]
}

Rules:
- ONLY emit JSON. No markdown, no explanation, no surrounding text.
- Steps execute in order. To reference a previous step's result, use \`$N.field\` where N is the 1-based step index.
- "task_ref" in launch_session usually points at the previous create_task step: "$1.id".
- Set "needs_confirmation": true whenever the plan launches a session or modifies state in a way the user might want to double-check.
- Pick "workspace_slug" from this exact list of existing workspaces — never invent a slug:
${workspaceList}
- Pick "brain_id" from this list of available brains — never invent a brain id:
${brainList}
- If the user references an existing task (not creating a new one), pick its id from this list — never invent a task id:
${taskList}
- Default brain_id is "claude-code-cli" if the user mentions Claude or "codex-cli" if they mention Codex. Otherwise default to "stub-worker".
- Default mode is "headless".
- Keep "goal" concrete: a single sentence describing what the brain should do, including the file or module if mentioned.
- Use 1–4 steps. Do not chain extra reads unless the user asked for them.

Worked example 1
User: "Add a /health endpoint task to project brief and launch Claude Code on it."
Output:
{"intent":"Add /health endpoint task to brief and launch Claude on it","needs_confirmation":true,"steps":[{"kind":"create_task","args":{"workspace_slug":"brief","title":"Add /health endpoint","type":"feature","priority":"high"}},{"kind":"launch_session","args":{"workspace_slug":"brief","task_ref":"$1.id","brain_id":"claude-code-cli","mode":"headless","goal":"Add a /health endpoint to apps/api/src/index.ts and a passing test."}}]}

Worked example 2
User: "Create a low-priority chore in ward to clean up TODO comments."
Output:
{"intent":"Create chore task in ward to clean up TODO comments","needs_confirmation":false,"steps":[{"kind":"create_task","args":{"workspace_slug":"ward","title":"Clean up TODO comments","type":"chore","priority":"low"}}]}

Worked example 3
User: "What does the brief workspace look like right now?"
Output:
{"intent":"Show the brief workspace summary","needs_confirmation":false,"steps":[{"kind":"read_workspace","args":{"workspace_slug":"brief"}}]}

Now produce the plan for the user's most recent message. JSON only.`;
}

const CASES = [
  "Add a /health endpoint task to brief and launch Claude Code on it.",
  "Create a new task for kwentalk to wire up the websocket",
  "create a task to fix the login bug in ward",
  "make a chore in ward to clean up TODO comments",
  "kick off a Codex session on task task_abcd1234 to refactor the api"
];

async function chat(messages: { role: string; content: string }[], formatJson = true) {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    temperature: 0.2,
    max_tokens: 768,
    stream: false,
    keep_alive: "60m",
    think: false
  };
  if (formatJson) body.format = "json";
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? "";
}

function tryExtractJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

async function main() {
  const system = composeOrbConductorPrompt();
  console.log(`=== Plan probe ===\nModel: ${MODEL}\n`);
  let valid = 0;

  for (const msg of CASES) {
    const startedAt = Date.now();
    let raw = "";
    try {
      raw = await chat([
        { role: "system", content: system },
        { role: "user", content: msg }
      ]);
    } catch (err) {
      console.log(`ERR  ${msg} -> ${(err as Error).message}`);
      continue;
    }
    const elapsed = Date.now() - startedAt;
    const extracted = tryExtractJson(raw);
    const parsed = extracted ? OrbPlanSchema.safeParse(extracted) : null;
    const ok = parsed?.success;
    if (ok) valid++;
    console.log(`${ok ? "VALID  " : "INVALID"} (${elapsed}ms)`);
    console.log(`  msg: ${msg}`);
    console.log(`  raw: ${raw.slice(0, 280).replace(/\n/g, " ")}`);
    if (parsed && !parsed.success) {
      console.log(`  err: ${parsed.error.issues.slice(0, 2).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    console.log();
  }
  console.log(`Totals: valid=${valid}/${CASES.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
