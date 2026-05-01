import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type StubStep =
  | { type: "status"; state: string; detail: string; progress_pct: number; delay_ms: number }
  | { type: "message"; role: "assistant" | "system"; text: string; delay_ms: number }
  | { type: "artifact"; artifact_kind: string; file_name: string; body: string; note?: string; delay_ms: number }
  | { type: "tool_call"; tool_name: string; input?: unknown; delay_ms: number };

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

  if (scenarioName === "fails") {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
