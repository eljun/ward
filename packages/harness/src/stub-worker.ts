import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type StubStep =
  | { type: "status"; state: string; detail: string; progress_pct: number; delay_ms: number }
  | { type: "message"; role: "assistant" | "system"; text: string; delay_ms: number }
  | { type: "artifact"; artifact_kind: string; file_name: string; body: string; note?: string; delay_ms: number }
  | { type: "tool_call"; tool_name: string; input?: unknown; delay_ms: number }
  | { type: "agent_signal"; agent_id: string; status: "pass" | "needs_work" | "blocked"; summary: string; missing_evidence?: string[]; delay_ms: number }
  | { type: "file_write"; relative_path: string; body: string; delay_ms: number }
  | { type: "wait_input"; prompt: string; delay_ms: number }
  | { type: "burst"; count: number; delay_ms: number };

const SCENARIOS: Record<string, StubStep[]> = {
  default: [
    { type: "status", state: "initializing", detail: "Stub worker booting.", progress_pct: 0.05, delay_ms: 20 },
    { type: "message", role: "assistant", text: "Reading task contract and context packet.", delay_ms: 20 },
    { type: "status", state: "implementing", detail: "Simulating implementation work.", progress_pct: 0.35, delay_ms: 40 },
    { type: "message", role: "assistant", text: "Applying a deterministic stub workflow.", delay_ms: 40 },
    { type: "status", state: "testing", detail: "Running stub verification.", progress_pct: 0.72, delay_ms: 40 },
    { type: "status", state: "creating_artifacts", detail: "Writing harness artifacts.", progress_pct: 0.9, delay_ms: 40 },
    {
      type: "artifact",
      artifact_kind: "report",
      file_name: "stub-report.md",
      body: "# Stub Report\n\nThe harness stub completed successfully.\n",
      note: "Wrote a stub verification report.",
      delay_ms: 20
    },
    { type: "agent_signal", agent_id: "stub-worker", status: "pass", summary: "Stub worker completed all scripted steps.", delay_ms: 20 },
    { type: "status", state: "done", detail: "Stub worker finished.", progress_pct: 1, delay_ms: 20 }
  ],
  fails: [
    { type: "status", state: "initializing", detail: "Stub worker booting.", progress_pct: 0.05, delay_ms: 20 },
    { type: "status", state: "implementing", detail: "Simulating a worker failure.", progress_pct: 0.25, delay_ms: 40 },
    { type: "message", role: "assistant", text: "Encountered a deterministic stub failure.", delay_ms: 20 }
  ],
  "await-approval": [
    { type: "status", state: "initializing", detail: "Stub worker booting.", progress_pct: 0.05, delay_ms: 20 },
    { type: "status", state: "implementing", detail: "Preparing a gated action.", progress_pct: 0.32, delay_ms: 40 },
    { type: "status", state: "awaiting_approval", detail: "Waiting for approval before proceeding.", progress_pct: 0.5, delay_ms: 40 }
  ],
  "tool-denied": [
    { type: "status", state: "initializing", detail: "Stub worker booting.", progress_pct: 0.05, delay_ms: 20 },
    { type: "status", state: "implementing", detail: "Requesting a disallowed fake tool.", progress_pct: 0.3, delay_ms: 30 },
    { type: "tool_call", tool_name: "shell.exec", input: { command: "echo should-not-run" }, delay_ms: 20 },
    { type: "status", state: "done", detail: "Stub worker observed the denial and stopped.", progress_pct: 1, delay_ms: 20 }
  ],
  "idle-timeout": [
    { type: "status", state: "initializing", detail: "Stub worker booting before an idle pause.", progress_pct: 0.05, delay_ms: 20 },
    { type: "message", role: "assistant", text: "This message should only appear if the idle watchdog is too loose.", delay_ms: 5000 }
  ],
  "visible-echo": [
    { type: "status", state: "initializing", detail: "Visible stub terminal ready.", progress_pct: 0.1, delay_ms: 20 },
    { type: "wait_input", prompt: "Type into the visible terminal to continue.", delay_ms: 20 },
    { type: "status", state: "done", detail: "Visible terminal input received.", progress_pct: 1, delay_ms: 20 }
  ],
  "qa-missing-evidence": [
    { type: "status", state: "testing", detail: "QA supervisor reviewing fake evidence.", progress_pct: 0.65, delay_ms: 20 },
    {
      type: "agent_signal",
      agent_id: "qa-supervisor",
      status: "needs_work",
      summary: "Acceptance criterion lacks matching test evidence.",
      missing_evidence: ["AC1: Session reaches done"],
      delay_ms: 20
    },
    { type: "status", state: "blocked", detail: "QA supervisor found missing evidence.", progress_pct: 1, delay_ms: 20 }
  ],
  "file-write": [
    { type: "status", state: "implementing", detail: "Writing a reversible stub file.", progress_pct: 0.45, delay_ms: 20 },
    { type: "file_write", relative_path: ".ward-stub-session-output.txt", body: "stub session wrote this file\n", delay_ms: 20 },
    { type: "status", state: "done", detail: "Stub file write complete.", progress_pct: 1, delay_ms: 20 }
  ],
  throughput: [
    { type: "status", state: "implementing", detail: "Emitting high-throughput stub events.", progress_pct: 0.25, delay_ms: 20 },
    { type: "burst", count: 1200, delay_ms: 0 },
    { type: "status", state: "done", detail: "High-throughput stub complete.", progress_pct: 1, delay_ms: 20 }
  ],
  "long-running": [
    { type: "status", state: "implementing", detail: "Holding a long-running stub session.", progress_pct: 0.25, delay_ms: 20 },
    { type: "message", role: "assistant", text: "Long-running stub completed after hold.", delay_ms: 60000 },
    { type: "status", state: "done", detail: "Long-running stub complete.", progress_pct: 1, delay_ms: 20 }
  ]
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function emit(step: StubStep): Promise<void> {
  if (step.type === "artifact") {
    const artifactsDir = process.env.WARD_ARTIFACTS_DIR;
    if (!artifactsDir) {
      throw new Error("WARD_ARTIFACTS_DIR is required for artifact steps.");
    }
    await mkdir(artifactsDir, { recursive: true, mode: 0o700 });
    const artifactPath = join(artifactsDir, step.file_name);
    await writeFile(artifactPath, step.body, "utf8");
    process.stdout.write(`${JSON.stringify({
      type: "artifact",
      artifact_kind: step.artifact_kind,
      path: artifactPath,
      note: step.note
    })}\n`);
    return;
  }

  if (step.type === "tool_call") {
    process.stdout.write(`${JSON.stringify({
      type: "tool_call",
      tool_name: step.tool_name,
      input: step.input
    })}\n`);
    return;
  }

  if (step.type === "agent_signal") {
    process.stdout.write(`${JSON.stringify({
      type: "agent_signal",
      agent_id: step.agent_id,
      status: step.status,
      summary: step.summary,
      missing_evidence: step.missing_evidence ?? []
    })}\n`);
    return;
  }

  if (step.type === "file_write") {
    const target = join(process.cwd(), step.relative_path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, step.body, "utf8");
    process.stdout.write(`${JSON.stringify({
      type: "file_write",
      relative_path: step.relative_path,
      body: step.body
    })}\n`);
    return;
  }

  if (step.type === "wait_input") {
    process.stdout.write(`${JSON.stringify({
      type: "message",
      role: "system",
      text: step.prompt
    })}\n`);
    const input = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve(""), 10000);
      process.stdin.once("data", (chunk) => {
        clearTimeout(timer);
        resolve(String(chunk).trim());
      });
    });
    process.stdin.pause();
    process.stdout.write(`${JSON.stringify({
      type: "message",
      role: "assistant",
      text: input ? `Received terminal input: ${input}` : "No terminal input received before timeout."
    })}\n`);
    return;
  }

  if (step.type === "burst") {
    for (let index = 0; index < step.count; index += 1) {
      process.stdout.write(`${JSON.stringify({
        type: "message",
        role: "assistant",
        text: `burst event ${index + 1}`
      })}\n`);
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(step)}\n`);
}

async function main(): Promise<void> {
  const scenarioName = process.env.WARD_SCENARIO ?? "default";
  const steps = SCENARIOS[scenarioName];
  if (!steps) {
    throw new Error(`Unknown stub scenario: ${scenarioName}`);
  }

  for (const step of steps) {
    await sleep(step.delay_ms);
    await emit(step);
  }
  process.stdin.pause();

  if (scenarioName === "fails") {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
