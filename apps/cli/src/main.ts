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

type FlagParse = {
  positional: string[];
  flags: Record<string, string | boolean>;
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

function parseFlags(args: string[]): FlagParse {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return { positional, flags };
}

function stringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

async function ensureRuntime(): Promise<void> {
  if (await healthFetch()) {
    return;
  }
  await commandUp();
}

async function apiRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  await ensureRuntime();
  const paths = resolveWardPaths();
  const state = await readRuntimeState(paths);
  if (!state.port) {
    throw new Error("WARD runtime port is unavailable.");
  }
  const token = await readDeviceToken(paths);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type") && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`http://127.0.0.1:${state.port}${path}`, {
    ...init,
    headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error ?? `Request failed with ${response.status}`);
  }
  return data as T;
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

async function commandProfile(args: string[]): Promise<CliResult> {
  const [subcommand, key, ...rest] = args;
  if (subcommand === "show" || subcommand === undefined) {
    const data = await apiRequest("/api/profile");
    return { ok: true, command: "profile show", timestamp: nowIso(), message: "WARD profile.", data };
  }
  if (subcommand === "set" && key && rest.length > 0) {
    const raw = rest.join(" ");
    const value = key === "tts_enabled" ? raw === "true" : Number.isFinite(Number(raw)) && ["tts_rate", "tts_pitch"].includes(key) ? Number(raw) : raw;
    const data = await apiRequest("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({ [key]: value })
    });
    return { ok: true, command: "profile set", timestamp: nowIso(), message: "WARD profile updated.", data };
  }
  throw new Error("Usage: ward profile show | ward profile set <key> <value>");
}

async function commandCreateWorkspace(args: string[]): Promise<CliResult> {
  const parsed = parseFlags(args);
  const name = parsed.positional.join(" ");
  if (!name) {
    throw new Error("Usage: ward create-workspace <name> [--description ...] [--repo <path>]");
  }
  const data = await apiRequest("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({
      name,
      description: stringFlag(parsed.flags, "description") ?? "",
      repo: stringFlag(parsed.flags, "repo"),
      autonomy_level: stringFlag(parsed.flags, "autonomy") ?? "standard"
    })
  });
  return { ok: true, command: "create-workspace", timestamp: nowIso(), message: "Workspace created.", data };
}

async function commandWorkspaces(): Promise<CliResult> {
  const data = await apiRequest("/api/workspaces");
  return { ok: true, command: "workspaces", timestamp: nowIso(), message: "WARD workspaces.", data };
}

async function commandWorkspace(args: string[]): Promise<CliResult> {
  const [slug] = args;
  if (!slug) {
    throw new Error("Usage: ward workspace <slug>");
  }
  const data = await apiRequest(`/api/workspaces/${encodeURIComponent(slug)}`);
  return { ok: true, command: "workspace", timestamp: nowIso(), message: "WARD workspace.", data };
}

async function commandAttach(args: string[]): Promise<CliResult> {
  const [workspace, path] = args;
  if (!workspace || !path) {
    throw new Error("Usage: ward attach <workspace-slug> <path>");
  }
  const data = await apiRequest(`/api/workspaces/${encodeURIComponent(workspace)}/attachments`, {
    method: "POST",
    body: JSON.stringify({ path })
  });
  return { ok: true, command: "attach", timestamp: nowIso(), message: "Attachment ingested.", data };
}

async function commandTasks(args: string[]): Promise<CliResult> {
  const parsed = parseFlags(args);
  const workspace = stringFlag(parsed.flags, "workspace");
  const suffix = workspace ? `?workspace=${encodeURIComponent(workspace)}` : "";
  const data = await apiRequest(`/api/tasks${suffix}`);
  return { ok: true, command: "tasks", timestamp: nowIso(), message: "WARD tasks.", data };
}

async function commandTask(args: string[]): Promise<CliResult> {
  const [subcommand, ...rest] = args;
  if (!subcommand) {
    throw new Error("Usage: ward task <task-id> | ward task create ...");
  }

  if (subcommand === "create") {
    const parsed = parseFlags(rest);
    const [workspace, ...titleParts] = parsed.positional;
    const title = titleParts.join(" ");
    if (!workspace || !title) {
      throw new Error("Usage: ward task create <workspace-slug> <title> [--type ...] [--priority ...]");
    }
    const data = await apiRequest("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        workspace_slug: workspace,
        title,
        type: stringFlag(parsed.flags, "type") ?? "feature",
        priority: stringFlag(parsed.flags, "priority") ?? "medium",
        description: stringFlag(parsed.flags, "description") ?? ""
      })
    });
    return { ok: true, command: "task create", timestamp: nowIso(), message: "Task created.", data };
  }

  if (subcommand === "transition") {
    const parsed = parseFlags(rest);
    const [taskId, status] = parsed.positional;
    if (!taskId || !status) {
      throw new Error("Usage: ward task transition <task-id> <status> [--phase ...] [--reason ...]");
    }
    const data = await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/transition`, {
      method: "POST",
      body: JSON.stringify({
        status,
        phase: stringFlag(parsed.flags, "phase"),
        reason: stringFlag(parsed.flags, "reason") ?? "CLI transition"
      })
    });
    return { ok: true, command: "task transition", timestamp: nowIso(), message: "Task transitioned.", data };
  }

  if (subcommand === "gate" && rest[0] === "open") {
    const parsed = parseFlags(rest.slice(1));
    const [taskId, gateType] = parsed.positional;
    if (!taskId || !gateType) {
      throw new Error("Usage: ward task gate open <task-id> <gate-type> --reason <reason>");
    }
    const data = await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/gates`, {
      method: "POST",
      body: JSON.stringify({
        gate_type: gateType,
        reason: stringFlag(parsed.flags, "reason") ?? "CLI gate",
        requested_by: stringFlag(parsed.flags, "by") ?? "orchestrator"
      })
    });
    return { ok: true, command: "task gate open", timestamp: nowIso(), message: "Task gate opened.", data };
  }

  if (subcommand === "approve" || subcommand === "reject") {
    const parsed = parseFlags(rest);
    const [taskId] = parsed.positional;
    if (!taskId) {
      throw new Error(`Usage: ward task ${subcommand} <task-id> [--gate <gate-id>] [--reason ...]`);
    }
    const data = await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/${subcommand}`, {
      method: "POST",
      body: JSON.stringify({
        gate_id: stringFlag(parsed.flags, "gate"),
        note: stringFlag(parsed.flags, "reason") ?? stringFlag(parsed.flags, "note")
      })
    });
    return { ok: true, command: `task ${subcommand}`, timestamp: nowIso(), message: `Task gate ${subcommand}d.`, data };
  }

  if (subcommand === "artifact" && rest[0] === "add") {
    const parsed = parseFlags(rest.slice(1));
    const [taskId, path] = parsed.positional;
    if (!taskId || !path) {
      throw new Error("Usage: ward task artifact add <task-id> <path> [--kind ...]");
    }
    const data = await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/artifacts`, {
      method: "POST",
      body: JSON.stringify({
        path,
        artifact_kind: stringFlag(parsed.flags, "kind") ?? "file"
      })
    });
    return { ok: true, command: "task artifact add", timestamp: nowIso(), message: "Task artifact attached.", data };
  }

  const data = await apiRequest(`/api/tasks/${encodeURIComponent(subcommand)}`);
  return { ok: true, command: "task", timestamp: nowIso(), message: "WARD task.", data };
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
    case "profile":
      return commandProfile(rest);
    case "create-workspace":
      return commandCreateWorkspace(rest);
    case "workspaces":
      return commandWorkspaces();
    case "workspace":
      return commandWorkspace(rest);
    case "attach":
      return commandAttach(rest);
    case "tasks":
      return commandTasks(rest);
    case "task":
      return commandTask(rest);
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
