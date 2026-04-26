#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, statSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { resolve } from "node:path";
import { CliResultSchema, type CliResult, type DoctorCheck, nowIso } from "@ward/core";
import {
  ensureDeviceToken,
  ensureWardLayout,
  findAvailablePort,
  getCurrentSchemaVersion,
  isPortAvailable,
  readDeviceToken,
  readRuntimeState,
  resolveRepoRoot,
  resolveWardPaths,
  rotateDeviceToken,
  runMigrations
} from "@ward/memory";
import { openWardDatabase } from "@ward/memory";

type ParsedArgs = {
  json: boolean;
  args: string[];
};

const require = createRequire(import.meta.url);

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  const jsonIndex = args.indexOf("--json");
  const json = jsonIndex !== -1;
  if (json) {
    args.splice(jsonIndex, 1);
  }
  return { json, args };
}

function emit(result: CliResult, asJson: boolean): void {
  const parsed = CliResultSchema.parse(result);
  if (asJson) {
    process.stdout.write(`${JSON.stringify(parsed)}\n`);
    return;
  }

  if (parsed.message) {
    process.stdout.write(`${parsed.message}\n`);
  }
  if (parsed.data && typeof parsed.data === "object") {
    process.stdout.write(`${JSON.stringify(parsed.data, null, 2)}\n`);
  }
}

function fail(command: string, error: unknown, asJson: boolean): never {
  emit({
    ok: false,
    command,
    timestamp: nowIso(),
    message: error instanceof Error ? error.message : String(error)
  }, asJson);
  process.exit(1);
}

async function healthFetch(): Promise<unknown | null> {
  const paths = resolveWardPaths();
  const state = await readRuntimeState(paths);
  if (!state.running || !state.port) {
    return null;
  }
  const token = await readDeviceToken(paths);
  const response = await fetch(`http://127.0.0.1:${state.port}/api/health`, {
    headers: { authorization: `Bearer ${token}` }
  }).catch(() => null);
  if (!response?.ok) {
    return null;
  }
  return response.json();
}

async function commandInit(): Promise<CliResult> {
  const paths = resolveWardPaths();
  const repoRoot = resolveRepoRoot();
  await ensureWardLayout(paths);
  await ensureDeviceToken(paths);
  const migrations = await runMigrations(paths, { repoRoot });
  return {
    ok: true,
    command: "init",
    timestamp: nowIso(),
    message: "WARD initialized.",
    data: {
      home: paths.home,
      db: paths.dbFile,
      schema_version: migrations.currentVersion,
      migrations_applied: migrations.applied
    }
  };
}

async function waitForRuntime(timeoutMs = 5000): Promise<unknown | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const health = await healthFetch();
    if (health) {
      return health;
    }
    await Bun.sleep(100);
  }
  return null;
}

async function commandUp(): Promise<CliResult> {
  const existing = await healthFetch();
  if (existing) {
    throw new Error("WARD runtime is already running.");
  }

  await commandInit();
  const repoRoot = resolveRepoRoot();
  const runtimeEntry = resolve(repoRoot, "apps/runtime/src/index.ts");
  const child = spawn(process.execPath, [runtimeEntry], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      WARD_REPO_ROOT: repoRoot
    }
  });
  child.unref();

  const health = await waitForRuntime();
  if (!health) {
    throw new Error("Runtime did not become healthy within 5 seconds.");
  }

  return {
    ok: true,
    command: "up",
    timestamp: nowIso(),
    message: "WARD runtime started.",
    data: health
  };
}

async function commandStatus(): Promise<CliResult> {
  const paths = resolveWardPaths();
  const state = await readRuntimeState(paths);
  const health = await healthFetch();
  return {
    ok: true,
    command: "status",
    timestamp: nowIso(),
    message: state.running ? "WARD runtime is running." : "WARD runtime is stopped.",
    data: {
      ...state,
      health
    }
  };
}

async function commandDown(): Promise<CliResult> {
  const paths = resolveWardPaths();
  const state = await readRuntimeState(paths);
  if (!state.pid || !state.running) {
    return {
      ok: true,
      command: "down",
      timestamp: nowIso(),
      message: "WARD runtime is already stopped.",
      data: state
    };
  }

  process.kill(state.pid, "SIGTERM");
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const next = await readRuntimeState(paths);
    if (!next.running) {
      return {
        ok: true,
        command: "down",
        timestamp: nowIso(),
        message: "WARD runtime stopped.",
        data: next
      };
    }
    await Bun.sleep(100);
  }
  throw new Error(`Runtime pid ${state.pid} did not stop within 5 seconds.`);
}

function commandExists(command: string): boolean {
  return spawnSync("which", [command], { stdio: "ignore" }).status === 0;
}

async function ptySmoke(): Promise<string> {
  ensureNodePtyHelperExecutable();
  const script = `
const pty = require("node-pty");
let output = "";
const term = pty.spawn("/bin/echo", ["ward-pty-ok"], {
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env
});
const timer = setTimeout(() => {
  console.error("PTY smoke timed out.");
  try { term.kill(); } catch {}
  process.exit(1);
}, 2500);
term.onData((data) => {
  output += data;
  if (output.includes("ward-pty-ok")) {
    clearTimeout(timer);
    process.stdout.write("node-pty produced expected output via Node helper.");
    process.exit(0);
  }
});
term.onExit(({ exitCode }) => {
  if (!output.includes("ward-pty-ok")) {
    clearTimeout(timer);
    console.error("PTY exited with " + exitCode + " before expected output.");
    process.exit(1);
  }
});
`;

  return new Promise((resolvePromise, reject) => {
    const child = spawn("node", ["-e", script], {
      cwd: resolveRepoRoot(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `PTY smoke helper exited with ${code}`));
      }
    });
  });
}

function ensureNodePtyHelperExecutable(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const nodePtyEntry = require.resolve("node-pty");
  const nodePtyRoot = dirname(dirname(nodePtyEntry));
  const helper = join(nodePtyRoot, "prebuilds", `darwin-${process.arch}`, "spawn-helper");
  if (existsSync(helper)) {
    chmodSync(helper, 0o755);
  }
}

async function commandDoctor(): Promise<CliResult> {
  const paths = resolveWardPaths();
  const checks: DoctorCheck[] = [];

  checks.push({ name: "bun", status: "pass", detail: `Bun ${Bun.version}` });

  try {
    await ensureWardLayout(paths);
    checks.push({ name: "ward_home", status: "pass", detail: paths.home });
  } catch (error) {
    checks.push({ name: "ward_home", status: "fail", detail: String(error) });
  }

  const state = await readRuntimeState(paths);
  if (state.running) {
    checks.push({ name: "pid_lock", status: "pass", detail: `runtime pid ${state.pid}` });
  } else if (state.pid) {
    checks.push({ name: "pid_lock", status: "warn", detail: `stale pid ${state.pid}` });
  } else {
    checks.push({ name: "pid_lock", status: "pass", detail: "no active runtime lock" });
  }

  const candidatePort = state.port ?? await findAvailablePort();
  const free = state.running ? false : await isPortAvailable(candidatePort);
  checks.push({
    name: "port",
    status: state.running || free ? "pass" : "fail",
    detail: state.running ? `runtime using ${candidatePort}` : `${candidatePort} ${free ? "available" : "unavailable"}`
  });

  if (existsSync(paths.deviceKeyFile)) {
    const mode = statSync(paths.deviceKeyFile).mode & 0o777;
    checks.push({
      name: "device_token",
      status: mode === 0o600 ? "pass" : "fail",
      detail: `mode ${mode.toString(8)}`
    });
  } else {
    checks.push({ name: "device_token", status: "fail", detail: "missing; run ward init" });
  }

  try {
    await runMigrations(paths, { repoRoot: resolveRepoRoot() });
    const db = openWardDatabase(paths);
    try {
      checks.push({ name: "schema", status: "pass", detail: `version ${getCurrentSchemaVersion(db)}` });
    } finally {
      db.close();
    }
  } catch (error) {
    checks.push({ name: "schema", status: "fail", detail: String(error) });
  }

  checks.push({
    name: "keychain",
    status: commandExists("security") ? "pass" : "warn",
    detail: commandExists("security") ? "macOS security CLI available; keychain integration lands in 009" : "security CLI missing"
  });

  for (const command of ["claude", "codex"]) {
    checks.push({
      name: `${command}_cli`,
      status: commandExists(command) ? "pass" : "warn",
      detail: commandExists(command) ? `${command} found on PATH` : `${command} not found on PATH`
    });
  }

  try {
    checks.push({ name: "pty_smoke", status: "pass", detail: await ptySmoke() });
  } catch (error) {
    checks.push({ name: "pty_smoke", status: "fail", detail: error instanceof Error ? error.message : String(error) });
  }

  const failed = checks.some((check) => check.status === "fail");
  return {
    ok: !failed,
    command: "doctor",
    timestamp: nowIso(),
    message: failed ? "WARD doctor found issues." : "WARD doctor passed.",
    data: { checks }
  };
}

async function commandAuth(args: string[]): Promise<CliResult> {
  const [subcommand] = args;
  if (subcommand !== "rotate") {
    throw new Error("Usage: ward auth rotate");
  }
  const paths = resolveWardPaths();
  await rotateDeviceToken(paths);
  await chmod(paths.deviceKeyFile, 0o600);
  return {
    ok: true,
    command: "auth rotate",
    timestamp: nowIso(),
    message: "WARD device token rotated.",
    data: { device_key: paths.deviceKeyFile }
  };
}

async function dispatch(args: string[]): Promise<CliResult> {
  const [command, ...rest] = args;
  switch (command) {
    case "init":
      return commandInit();
    case "up":
      return commandUp();
    case "down":
      return commandDown();
    case "status":
    case undefined:
      return commandStatus();
    case "doctor":
      return commandDoctor();
    case "auth":
      return commandAuth(rest);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

const parsed = parseArgs(process.argv.slice(2));
try {
  emit(await dispatch(parsed.args), parsed.json);
} catch (error) {
  fail(parsed.args[0] ?? "status", error, parsed.json);
}
