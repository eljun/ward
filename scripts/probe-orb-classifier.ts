#!/usr/bin/env bun
/**
 * Probe the conductor classifier and plan generator against real Ollama.
 * Run: bun scripts/probe-orb-classifier.ts
 */

const BASE = "http://127.0.0.1:11434/v1";
const MODEL = process.env.MODEL ?? "gemma4:e2b";

const CLASSIFIER_SYSTEM =
  "Classify the next user message. Reply with ONE word: \"conductor\" if it asks W.A.R.D to take a multi-step action (create, launch, assign, configure), or \"chat\" if it is conversational or a question. Output only one word.";

const CASES = [
  // Direct imperatives — should be CONDUCTOR
  "Add a /health endpoint task to brief and launch Claude Code on it.",
  "Create a new task for Project X",
  "create a task to fix the login bug in ward",
  "add new task for kwentalk to wire up the websocket",
  "kick off a Codex session on task abc to refactor the api",
  "make a chore in ward to clean up TODO comments",
  // Polite paraphrases — should still be CONDUCTOR
  "could you set up a task for kwentalk to wire the websocket?",
  "I want a new feature task on ward titled 'rate limit the api'",
  "please launch claude on the kwentalk websocket task",
  // Conversational — should be CHAT
  "what should I work on?",
  "how am I doing today?",
  "tell me about my open sessions",
  "what's the status of brief?",
  // Ambiguous nav — should NOT be conductor
  "open Sessions"
];

async function chat(messages: { role: string; content: string }[], opts: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0,
      max_tokens: 8,
      stream: false,
      keep_alive: "60m",
      think: false,
      ...opts
    })
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? "";
}

async function main() {
  console.log("=== Classifier probe ===");
  console.log(`Model: ${MODEL}`);
  console.log(`System: ${CLASSIFIER_SYSTEM}\n`);

  let conductor = 0;
  let chatHits = 0;
  let other = 0;

  for (const msg of CASES) {
    const startedAt = Date.now();
    let raw = "";
    try {
      raw = await chat([
        { role: "system", content: CLASSIFIER_SYSTEM },
        { role: "user", content: msg }
      ]);
    } catch (err) {
      console.log(`ERR  ${msg}\n     -> ${(err as Error).message}`);
      continue;
    }
    const elapsed = Date.now() - startedAt;
    const word = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
    let bucket: string;
    if (word === "conductor") { bucket = "CONDUCTOR"; conductor++; }
    else if (word === "chat") { bucket = "CHAT      "; chatHits++; }
    else { bucket = "OTHER     "; other++; }
    console.log(`${bucket} (${elapsed}ms, raw=${JSON.stringify(raw.slice(0, 40))})`);
    console.log(`  msg: ${msg}`);
  }

  console.log(`\nTotals: conductor=${conductor}, chat=${chatHits}, other=${other} of ${CASES.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
