import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import {
  RepoSnapshotSchema,
  nowIso,
  type RepoSnapshot
} from "@ward/core";
import type { Database } from "bun:sqlite";
import { ensureWardLayout, resolveWardPaths, type WardPaths } from "./layout.ts";
import { openWardDatabase } from "./migrations.ts";

type RepoRow = {
  id: number;
  workspace_id: number;
  local_path: string;
  branch: string | null;
  is_primary: number;
  watch_enabled: number;
};

type SnapshotRow = Omit<RepoSnapshot, "file_tree" | "key_files" | "symbols" | "recent_commits"> & {
  file_tree_json: string;
  key_files_json: string;
  symbols_json: string;
  recent_commits_json: string;
};

const MAX_FILES = 300;
const MAX_SYMBOL_FILES = 80;
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".venv",
  "__pycache__"
]);

const KEY_FILES = new Set([
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "vite.config.ts",
  "README.md",
  "TASKS.md",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Dockerfile"
]);

function withDb<T>(fn: (db: Database, paths: WardPaths) => T): T {
  const paths = resolveWardPaths();
  const db = openWardDatabase(paths);
  try {
    return fn(db, paths);
  } finally {
    db.close();
  }
}

async function withDbAsync<T>(fn: (db: Database, paths: WardPaths) => Promise<T>): Promise<T> {
  const paths = resolveWardPaths();
  const db = openWardDatabase(paths);
  try {
    return await fn(db, paths);
  } finally {
    db.close();
  }
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function git(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function snapshotFromRow(row: SnapshotRow): RepoSnapshot {
  return RepoSnapshotSchema.parse({
    ...row,
    file_tree: JSON.parse(row.file_tree_json),
    key_files: JSON.parse(row.key_files_json),
    symbols: JSON.parse(row.symbols_json),
    recent_commits: JSON.parse(row.recent_commits_json)
  });
}

async function walk(root: string, current = "", out: string[] = []): Promise<string[]> {
  if (out.length >= MAX_FILES) {
    return out;
  }
  const absolute = join(root, current);
  const entries = await readdir(absolute, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= MAX_FILES) {
      break;
    }
    if (entry.name.startsWith(".") && entry.name !== ".github") {
      continue;
    }
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
      continue;
    }
    const rel = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(`${rel}/`);
      await walk(root, rel, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function isKeyFile(path: string): boolean {
  return KEY_FILES.has(basename(path)) || path.endsWith("/README.md");
}

function extractSymbols(path: string, text: string): Array<{ path: string; name: string; kind: string }> {
  const symbols: Array<{ path: string; name: string; kind: string }> = [];
  const patterns: Array<[RegExp, string]> = [
    [/\bexport\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g, "function"],
    [/\bfunction\s+([A-Za-z0-9_]+)/g, "function"],
    [/\bexport\s+class\s+([A-Za-z0-9_]+)/g, "class"],
    [/\bclass\s+([A-Za-z0-9_]+)/g, "class"],
    [/\bexport\s+const\s+([A-Za-z0-9_]+)/g, "const"],
    [/^def\s+([A-Za-z0-9_]+)/gm, "function"],
    [/^class\s+([A-Za-z0-9_]+)/gm, "class"],
    [/^func\s+([A-Za-z0-9_]+)/gm, "function"],
    [/^fn\s+([A-Za-z0-9_]+)/gm, "function"]
  ];
  for (const [pattern, kind] of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1] && symbols.length < 80) {
        symbols.push({ path, name: match[1], kind });
      }
    }
  }
  return symbols;
}

async function collectSymbols(root: string, files: string[]): Promise<Array<{ path: string; name: string; kind: string }>> {
  const candidates = files
    .filter((file) => /\.(ts|tsx|js|jsx|py|go|rs)$/.test(file))
    .filter((file) => !file.endsWith(".d.ts"))
    .slice(0, MAX_SYMBOL_FILES);
  const symbols: Array<{ path: string; name: string; kind: string }> = [];
  for (const file of candidates) {
    const absolute = join(root, file);
    const info = await stat(absolute).catch(() => null);
    if (!info || info.size > 200_000) {
      continue;
    }
    const text = await readFile(absolute, "utf8").catch(() => "");
    symbols.push(...extractSymbols(file, text));
  }
  return symbols.slice(0, 400);
}

async function writeSnapshotFile(paths: WardPaths, snapshot: RepoSnapshot): Promise<void> {
  const dir = join(paths.cacheDir, "repo-snapshots");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(snapshot.snapshot_path, JSON.stringify(snapshot, null, 2), "utf8");
}

export async function refreshRepoSnapshot(repoId: number): Promise<RepoSnapshot> {
  return withDbAsync(async (db, paths) => {
    await ensureWardLayout(paths);
    const repo = db.query<RepoRow, [number]>("SELECT * FROM workspace_repo WHERE id = ?").get(repoId);
    if (!repo) {
      throw new Error("Repo not found");
    }
    if (!existsSync(repo.local_path)) {
      throw new Error(`Repo path not found: ${repo.local_path}`);
    }

    const files = (await walk(repo.local_path)).filter((item) => !item.endsWith("/"));
    const branch = git(repo.local_path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const head = git(repo.local_path, ["rev-parse", "HEAD"]);
    const defaultBranch = git(repo.local_path, ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"])?.replace(/^origin\//, "")
      ?? git(repo.local_path, ["rev-parse", "--abbrev-ref", "origin/HEAD"])?.replace(/^origin\//, "")
      ?? "main";
    const recentCommits = git(repo.local_path, ["log", "--oneline", "--stat", "-10"])?.split("\n").filter(Boolean).slice(0, 80) ?? [];
    const diffSummary = git(repo.local_path, ["diff", "--stat", `${defaultBranch}...HEAD`])
      ?? git(repo.local_path, ["diff", "--stat"])
      ?? "";
    const timestamp = nowIso();
    const snapshotId = id("snapshot");
    const snapshotPath = join(paths.cacheDir, "repo-snapshots", `${snapshotId}.json`);
    const snapshot = RepoSnapshotSchema.parse({
      id: snapshotId,
      repo_id: repo.id,
      workspace_id: repo.workspace_id,
      local_path: repo.local_path,
      branch,
      head_commit: head,
      default_branch: defaultBranch,
      file_tree: files.slice(0, MAX_FILES),
      key_files: files.filter(isKeyFile),
      symbols: await collectSymbols(repo.local_path, files),
      recent_commits: recentCommits,
      diff_summary: diffSummary,
      snapshot_path: snapshotPath,
      refreshed_at: timestamp
    });
    await writeSnapshotFile(paths, snapshot);
    db.query(`
      INSERT INTO repo_snapshot (
        id, repo_id, workspace_id, local_path, branch, head_commit, default_branch,
        file_tree_json, key_files_json, symbols_json, recent_commits_json,
        diff_summary, snapshot_path, refreshed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repo_id) DO UPDATE SET
        id = excluded.id,
        workspace_id = excluded.workspace_id,
        local_path = excluded.local_path,
        branch = excluded.branch,
        head_commit = excluded.head_commit,
        default_branch = excluded.default_branch,
        file_tree_json = excluded.file_tree_json,
        key_files_json = excluded.key_files_json,
        symbols_json = excluded.symbols_json,
        recent_commits_json = excluded.recent_commits_json,
        diff_summary = excluded.diff_summary,
        snapshot_path = excluded.snapshot_path,
        refreshed_at = excluded.refreshed_at
    `).run(
      snapshot.id,
      snapshot.repo_id,
      snapshot.workspace_id,
      snapshot.local_path,
      snapshot.branch,
      snapshot.head_commit,
      snapshot.default_branch,
      JSON.stringify(snapshot.file_tree),
      JSON.stringify(snapshot.key_files),
      JSON.stringify(snapshot.symbols),
      JSON.stringify(snapshot.recent_commits),
      snapshot.diff_summary,
      snapshot.snapshot_path,
      snapshot.refreshed_at
    );
    return snapshot;
  });
}

export async function refreshWorkspaceSnapshots(workspaceIdOrSlug: string): Promise<RepoSnapshot[]> {
  const repos = withDb((db) => {
    const workspace = Number.isInteger(Number(workspaceIdOrSlug))
      ? db.query<{ id: number }, [number]>("SELECT id FROM workspace WHERE id = ?").get(Number(workspaceIdOrSlug))
      : db.query<{ id: number }, [string]>("SELECT id FROM workspace WHERE slug = ?").get(workspaceIdOrSlug);
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    return db.query<RepoRow, [number]>("SELECT * FROM workspace_repo WHERE workspace_id = ? AND watch_enabled = 1 ORDER BY is_primary DESC, id ASC")
      .all(workspace.id);
  });
  const snapshots: RepoSnapshot[] = [];
  for (const repo of repos) {
    snapshots.push(await refreshRepoSnapshot(repo.id));
  }
  return snapshots;
}

export function listRepoSnapshots(workspaceIdOrSlug?: string): RepoSnapshot[] {
  return withDb((db) => {
    if (!workspaceIdOrSlug) {
      return db.query<SnapshotRow, []>("SELECT * FROM repo_snapshot ORDER BY refreshed_at DESC").all().map(snapshotFromRow);
    }
    const workspace = Number.isInteger(Number(workspaceIdOrSlug))
      ? db.query<{ id: number }, [number]>("SELECT id FROM workspace WHERE id = ?").get(Number(workspaceIdOrSlug))
      : db.query<{ id: number }, [string]>("SELECT id FROM workspace WHERE slug = ?").get(workspaceIdOrSlug);
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    return db.query<SnapshotRow, [number]>("SELECT * FROM repo_snapshot WHERE workspace_id = ? ORDER BY refreshed_at DESC")
      .all(workspace.id)
      .map(snapshotFromRow);
  });
}

export async function refreshAllRepoSnapshots(): Promise<RepoSnapshot[]> {
  const repos = withDb((db) => db.query<RepoRow, []>("SELECT * FROM workspace_repo WHERE watch_enabled = 1 ORDER BY is_primary DESC, id ASC").all());
  const snapshots: RepoSnapshot[] = [];
  for (const repo of repos) {
    snapshots.push(await refreshRepoSnapshot(repo.id));
  }
  return snapshots;
}

export async function refreshChangedRepoSnapshots(): Promise<RepoSnapshot[]> {
  const rows = withDb((db) => db.query<(RepoRow & { prior_head: string | null }), []>(`
    SELECT workspace_repo.*, repo_snapshot.head_commit AS prior_head
    FROM workspace_repo
    LEFT JOIN repo_snapshot ON repo_snapshot.repo_id = workspace_repo.id
    WHERE workspace_repo.watch_enabled = 1
  `).all());
  const refreshed: RepoSnapshot[] = [];
  for (const repo of rows) {
    const head = existsSync(repo.local_path) ? git(repo.local_path, ["rev-parse", "HEAD"]) : null;
    if (head && head !== repo.prior_head) {
      refreshed.push(await refreshRepoSnapshot(repo.id));
    }
  }
  return refreshed;
}

export function snapshotSummary(snapshot: RepoSnapshot | null): string {
  if (!snapshot) {
    return "No repo snapshot available.";
  }
  const rel = relative(resolveWardPaths().home, snapshot.snapshot_path).split(sep).join("/");
  return [
    `Snapshot: ${rel}`,
    `Branch: ${snapshot.branch ?? "unknown"}`,
    `Head: ${snapshot.head_commit?.slice(0, 12) ?? "unknown"}`,
    `Files indexed: ${snapshot.file_tree.length}`,
    `Key files: ${snapshot.key_files.slice(0, 8).join(", ") || "none"}`,
    `Symbols: ${snapshot.symbols.slice(0, 8).map((symbol) => `${symbol.name} (${symbol.kind})`).join(", ") || "none"}`
  ].join("\n");
}
