import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  SecretBackendStatusSchema,
  SecretEntrySchema,
  SecretScopeSchema,
  SecretSelectorSchema,
  SecretSetSchema,
  nowIso,
  type SecretBackend,
  type SecretBackendStatus,
  type SecretEntry,
  type SecretScope,
  type SecretSelectorInput,
  type SecretSetInput
} from "@ward/core";
import type { Database } from "bun:sqlite";
import { ensureWardLayout, resolveWardPaths, type WardPaths } from "./layout.ts";
import { openWardDatabase } from "./migrations.ts";

type WorkspaceSecretRow = {
  id: number;
  slug: string;
};

type SecretIndexFile = {
  entries: SecretEntry[];
};

const KEYCHAIN_SERVICE = "WARD";

function withDb<T>(fn: (db: Database, paths: WardPaths) => T): T {
  const paths = resolveWardPaths();
  const db = openWardDatabase(paths);
  try {
    return fn(db, paths);
  } finally {
    db.close();
  }
}

function workspaceByRef(db: Database, ref: string | number): WorkspaceSecretRow | null {
  return db.query<WorkspaceSecretRow, [string, string]>(`
    SELECT id, slug
    FROM workspace
    WHERE slug = ? OR CAST(id AS TEXT) = ?
  `).get(String(ref), String(ref)) ?? null;
}

function requireWorkspace(ref: string | number | undefined): WorkspaceSecretRow {
  if (!ref) {
    throw new Error("Workspace is required for workspace secret scope");
  }
  return withDb((db) => {
    const workspace = workspaceByRef(db, ref);
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    return workspace;
  });
}

function secretKey(scope: SecretScope, name: string, workspaceSlug: string | null): string {
  return scope === "global"
    ? `ward.global.${name}`
    : `ward.workspace.${workspaceSlug}.${name}`;
}

function secretFileName(key: string): string {
  return `${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}.secret`;
}

function indexPath(paths: WardPaths): string {
  return join(paths.secretsDir, "index.json");
}

function secretFilePath(paths: WardPaths, key: string): string {
  return join(paths.secretsDir, secretFileName(key));
}

function commandExists(command: string): boolean {
  const path = process.env.PATH ?? "";
  return path.split(":").some((dir) => existsSync(join(dir, command)));
}

function selectedBackend(): SecretBackend {
  const forced = process.env.WARD_SECRET_BACKEND;
  if (forced === "file") {
    return "file";
  }
  if (forced === "keychain") {
    return "keychain";
  }
  return process.platform === "darwin" && commandExists("security") ? "keychain" : "file";
}

async function security(args: string[], stdin?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("security", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      resolvePromise({ code: null, stdout, stderr: error.message });
    });
    child.on("exit", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
    if (stdin !== undefined) {
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}

async function readIndex(paths: WardPaths): Promise<SecretEntry[]> {
  try {
    const raw = await readFile(indexPath(paths), "utf8");
    const parsed = JSON.parse(raw) as SecretIndexFile;
    return parsed.entries.map((entry) => SecretEntrySchema.parse(entry));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeIndex(paths: WardPaths, entries: SecretEntry[]): Promise<void> {
  await mkdir(paths.secretsDir, { recursive: true, mode: 0o700 });
  await writeFile(indexPath(paths), `${JSON.stringify({ entries }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(indexPath(paths), 0o600).catch(() => undefined);
}

function normalizeSelector(input: SecretSelectorInput): { scope: SecretScope; workspace: string | null } {
  const parsed = SecretSelectorSchema.parse(input);
  const scope = parsed.scope;
  const workspace = scope === "workspace" ? requireWorkspace(parsed.workspace).slug : null;
  return { scope, workspace };
}

async function upsertIndexEntry(paths: WardPaths, entry: SecretEntry): Promise<void> {
  const entries = await readIndex(paths);
  const next = [
    ...entries.filter((item) => item.key !== entry.key),
    entry
  ].sort((a, b) => `${a.scope}:${a.workspace ?? ""}:${a.name}`.localeCompare(`${b.scope}:${b.workspace ?? ""}:${b.name}`));
  await writeIndex(paths, next);
}

async function removeIndexEntry(paths: WardPaths, key: string): Promise<void> {
  await writeIndex(paths, (await readIndex(paths)).filter((entry) => entry.key !== key));
}

async function writeSecretValue(paths: WardPaths, backend: SecretBackend, key: string, value: string): Promise<void> {
  if (backend === "keychain") {
    const result = await security(["add-generic-password", "-a", key, "-s", KEYCHAIN_SERVICE, "-w", value, "-U"]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "Unable to write secret to macOS Keychain");
    }
    return;
  }
  await mkdir(paths.secretsDir, { recursive: true, mode: 0o700 });
  const path = secretFilePath(paths, key);
  await writeFile(path, value, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

async function readSecretValue(paths: WardPaths, backend: SecretBackend, key: string): Promise<string | null> {
  if (backend === "keychain") {
    const result = await security(["find-generic-password", "-a", key, "-s", KEYCHAIN_SERVICE, "-w"]);
    return result.code === 0 ? result.stdout.trimEnd() : null;
  }
  try {
    return await readFile(secretFilePath(paths, key), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function deleteSecretValue(paths: WardPaths, backend: SecretBackend, key: string): Promise<void> {
  if (backend === "keychain") {
    await security(["delete-generic-password", "-a", key, "-s", KEYCHAIN_SERVICE]);
    return;
  }
  await rm(secretFilePath(paths, key), { force: true });
}

export function getSecretBackendStatus(): SecretBackendStatus {
  const forced = process.env.WARD_SECRET_BACKEND === "file" || process.env.WARD_SECRET_BACKEND === "keychain";
  const backend = selectedBackend();
  return SecretBackendStatusSchema.parse({
    backend,
    forced,
    available: backend === "file" || commandExists("security"),
    detail: backend === "keychain"
      ? "macOS security CLI keychain backend"
      : "file fallback backend under WARD_HOME/secrets"
  });
}

export async function setSecret(input: SecretSetInput): Promise<SecretEntry> {
  const parsed = SecretSetSchema.parse(input);
  const paths = resolveWardPaths();
  await ensureWardLayout(paths);
  const workspace = parsed.scope === "workspace" ? requireWorkspace(parsed.workspace).slug : null;
  const backend = selectedBackend();
  const key = secretKey(parsed.scope, parsed.name, workspace);
  await writeSecretValue(paths, backend, key, parsed.value);
  const entry = SecretEntrySchema.parse({
    name: parsed.name,
    scope: parsed.scope,
    workspace,
    key,
    backend,
    updated_at: nowIso()
  });
  await upsertIndexEntry(paths, entry);
  return entry;
}

export async function rotateSecret(input: SecretSetInput): Promise<SecretEntry> {
  return setSecret(input);
}

export async function listSecrets(input: Partial<SecretSelectorInput> = {}): Promise<{ backend: SecretBackendStatus; entries: SecretEntry[] }> {
  const paths = resolveWardPaths();
  await ensureWardLayout(paths);
  const entries = await readIndex(paths);
  const scope = input.scope ? SecretScopeSchema.parse(input.scope) : undefined;
  const workspace = scope === "workspace" ? requireWorkspace(input.workspace).slug : undefined;
  return {
    backend: getSecretBackendStatus(),
    entries: entries.filter((entry) => {
      if (scope && entry.scope !== scope) {
        return false;
      }
      if (workspace && entry.workspace !== workspace) {
        return false;
      }
      return true;
    })
  };
}

export async function unsetSecret(name: string, input: SecretSelectorInput): Promise<{ name: string; scope: SecretScope; workspace: string | null; deleted: boolean }> {
  const paths = resolveWardPaths();
  await ensureWardLayout(paths);
  const selector = normalizeSelector(input);
  const key = secretKey(selector.scope, name, selector.workspace);
  const entries = await readIndex(paths);
  const entry = entries.find((item) => item.key === key);
  await deleteSecretValue(paths, entry?.backend ?? selectedBackend(), key);
  await removeIndexEntry(paths, key);
  return { name, scope: selector.scope, workspace: selector.workspace, deleted: Boolean(entry) };
}

export async function resolveSecretRef(name: string, input: SecretSelectorInput): Promise<string> {
  const paths = resolveWardPaths();
  await ensureWardLayout(paths);
  const selector = normalizeSelector(input);
  const keys = selector.scope === "workspace"
    ? [
        secretKey("workspace", name, selector.workspace),
        secretKey("global", name, null)
      ]
    : [secretKey("global", name, null)];
  const entries = await readIndex(paths);
  for (const key of keys) {
    const entry = entries.find((item) => item.key === key);
    const value = await readSecretValue(paths, entry?.backend ?? selectedBackend(), key);
    if (value !== null) {
      return value;
    }
  }
  throw new Error(`Secret not found: ${name}`);
}

export async function resolveSecretString(value: string, input: SecretSelectorInput): Promise<string> {
  if (!value.startsWith("secret://")) {
    return value;
  }
  return resolveSecretRef(value.slice("secret://".length), input);
}

