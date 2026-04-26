import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import {
  MemoryCommitSchema,
  MemoryPageSchema,
  MemoryPageSummarySchema,
  MemoryScopeSchema,
  SearchHitSchema,
  SearchQuerySchema,
  SearchableDocSchema,
  WikiLintFindingSchema,
  createEvent,
  createTraceId,
  type MemoryBackend,
  type MemoryCommit,
  type MemoryPage,
  type MemoryPageSummary,
  type MemoryScope,
  type SearchBackend,
  type SearchHit,
  type SearchableDoc,
  type WikiAuthor,
  type WikiLintFinding
} from "@ward/core";
import type { Database } from "bun:sqlite";
import { ensureWardLayout, resolveWardPaths, type WardPaths } from "./layout.ts";
import { openWardDatabase } from "./migrations.ts";

type GitResult = {
  status: number;
  stdout: string;
  stderr: string;
};

type WorkspaceLike = {
  id: number;
  name: string;
  slug: string;
  description?: string;
};

const UNIVERSAL_SEED: Record<string, string> = {
  "index.md": `# Universal Memory

Global WARD memory for preferences, reusable playbooks, routing notes, and install-wide log entries.

- [Preferences](preferences.md)
- [Playbooks](playbooks.md)
- [Routing](routing.md)
- [Log](log.md)
`,
  "log.md": `# Universal Log

Install-wide notes and handoff breadcrumbs.
`,
  "preferences.md": `# Preferences

User-confirmed preferences that should travel across workspaces.
`,
  "playbooks.md": `# Playbooks

Reusable workflows, checklists, and operating habits.
`,
  "routing.md": `# Routing

Brain, harness, and tool-routing notes.
`
};

function workspaceSeed(workspace: WorkspaceLike): Record<string, string> {
  return {
    "index.md": `# ${workspace.name}

Workspace wiki for ${workspace.name}.

- [Overview](overview.md)
- [Goals](goals.md)
- [Constraints](constraints.md)
- [Decisions](decisions.md)
- [Blockers](blockers.md)
- [Sessions](sessions.md)
`,
    "overview.md": `# Overview

${workspace.description?.trim() || "Workspace context and current shape."}
`,
    "goals.md": `# Goals

Workspace goals and success criteria.
`,
    "constraints.md": `# Constraints

Technical, product, and personal constraints.
`,
    "decisions.md": `# Decisions

Durable decisions and their reasoning.
`,
    "blockers.md": `# Blockers

Open blockers and dependency notes.
`,
    "sessions.md": `# Sessions

Session handoffs and summaries.
`
  };
}

const ROOT_SEED: Record<string, string> = {
  "SCHEMA.md": `# WARD Memory Schema

WARD memory is a git-backed markdown wiki.

## Scopes

- \`universal/\` holds install-wide memory.
- \`workspaces/<slug>/wiki/\` holds per-workspace memory.

## Authors

- User writes commit with \`[user]\`.
- LLM writes commit with \`[llm]\`.

## Linking

Use relative markdown links between wiki pages.
`
};

function withDb<T>(fn: (db: Database, paths: WardPaths) => T): T {
  const paths = resolveWardPaths();
  const db = openWardDatabase(paths);
  try {
    return fn(db, paths);
  } finally {
    db.close();
  }
}

function withDbPath<T>(paths: WardPaths, fn: (db: Database) => T): T {
  const db = openWardDatabase(paths);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

async function withDbPathAsync<T>(paths: WardPaths, fn: (db: Database) => Promise<T>): Promise<T> {
  const db = openWardDatabase(paths);
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

function gitAvailable(): boolean {
  return spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
}

function ensureGitAvailable(): void {
  if (!gitAvailable()) {
    throw new Error("Git is required for WARD wiki memory. Install git, then run ward init again.");
  }
}

function gitEnv(author: WikiAuthor = "user"): NodeJS.ProcessEnv {
  const identity = author === "llm"
    ? { name: "WARD Runtime", email: "ward@localhost" }
    : { name: "WARD User", email: "ward-user@localhost" };
  return {
    ...process.env,
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email
  };
}

function git(paths: WardPaths, args: string[], opts: { allowFailure?: boolean; author?: WikiAuthor } = {}): GitResult {
  const result = spawnSync("git", ["-C", paths.memoryDir, ...args], {
    encoding: "utf8",
    env: gitEnv(opts.author)
  });
  const status = result.status ?? 1;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (!opts.allowFailure && status !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `git ${args.join(" ")} failed with ${status}`);
  }
  return { status, stdout, stderr };
}

function gitPath(paths: WardPaths, absolutePath: string): string {
  return relative(paths.memoryDir, absolutePath).split(sep).join("/");
}

function scopeKey(scope: MemoryScope): string {
  return scope.kind === "universal" ? "universal" : `workspace/${scope.slug}`;
}

export function parseMemoryScope(input: string | MemoryScope): MemoryScope {
  if (typeof input !== "string") {
    return MemoryScopeSchema.parse(input);
  }
  const trimmed = input.trim();
  if (trimmed === "universal") {
    return { kind: "universal" };
  }
  if (trimmed.startsWith("workspace/")) {
    const slug = trimmed.slice("workspace/".length);
    if (!slug) {
      throw new Error("Workspace scope requires a slug.");
    }
    return { kind: "workspace", slug };
  }
  if (trimmed) {
    return { kind: "workspace", slug: trimmed };
  }
  throw new Error("Memory scope is required.");
}

function scopeDir(paths: WardPaths, scope: MemoryScope): string {
  return scope.kind === "universal"
    ? join(paths.memoryDir, "universal")
    : join(paths.memoryDir, "workspaces", scope.slug, "wiki");
}

function normalizePage(page: string): string {
  const cleaned = page.replaceAll("\\", "/").replace(/^\/+/, "").trim();
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Invalid wiki page path.");
  }
  const joined = parts.join("/");
  return joined.endsWith(".md") ? joined : `${joined}.md`;
}

function pagePath(paths: WardPaths, scope: MemoryScope, page: string): { absolute: string; relativePage: string; gitRelative: string } {
  const relativePage = normalizePage(page);
  const absolute = join(scopeDir(paths, scope), relativePage);
  return {
    absolute,
    relativePage,
    gitRelative: gitPath(paths, absolute)
  };
}

function titleFrom(page: string, body: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }
  return basename(page, ".md")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function writeIfMissing(path: string, body: string): Promise<boolean> {
  if (existsSync(path)) {
    return false;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, body, "utf8");
  return true;
}

async function writeSeedFiles(paths: WardPaths): Promise<boolean> {
  let changed = false;
  for (const [page, body] of Object.entries(ROOT_SEED)) {
    changed = await writeIfMissing(join(paths.memoryDir, page), body) || changed;
  }
  for (const [page, body] of Object.entries(UNIVERSAL_SEED)) {
    changed = await writeIfMissing(join(paths.memoryDir, "universal", page), body) || changed;
  }
  await mkdir(join(paths.memoryDir, "workspaces"), { recursive: true, mode: 0o700 });
  return changed;
}

function commitIfChanged(paths: WardPaths, relPaths: string[], author: WikiAuthor, message: string): boolean {
  git(paths, ["add", "-A", "--", ...relPaths], { author });
  const status = git(paths, ["status", "--porcelain", "--", ...relPaths], { author }).stdout.trim();
  if (!status) {
    return false;
  }
  git(paths, ["commit", "-m", message], { author });
  return true;
}

function deleteSearchDocs(db: Database, docIds: string[]): void {
  if (docIds.length === 0) {
    return;
  }
  const remove = db.transaction((ids: string[]) => {
    for (const docId of ids) {
      db.query("DELETE FROM search_document WHERE doc_id = ?").run(docId);
      db.query("DELETE FROM search_document_fts WHERE doc_id = ?").run(docId);
    }
  });
  remove(docIds);
}

function authorFromSubject(subject: string): "user" | "llm" | "system" {
  if (subject.startsWith("[user]")) {
    return "user";
  }
  if (subject.startsWith("[llm]")) {
    return "llm";
  }
  return "system";
}

function commitMessage(author: WikiAuthor, fallback: string, summary?: string): string {
  const prefix = `[${author}]`;
  if (summary?.trim()) {
    const trimmed = summary.trim();
    return trimmed.startsWith(prefix) ? trimmed : `${prefix} ${trimmed}`;
  }
  return `${prefix} ${fallback}`;
}

function recordSystemEvent(db: Database, event_type: string, payload: Record<string, unknown>): void {
  const event = createEvent({
    event_type,
    trace_id: createTraceId("wiki"),
    workspace_id: typeof payload.workspace_id === "number" ? payload.workspace_id : null,
    session_id: null,
    source: "runtime",
    payload
  });
  db.query(`
    INSERT INTO system_event (id, event_type, trace_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(event.event_id, event.event_type, event.trace_id, JSON.stringify(event.payload), event.timestamp);
}

function workspaceIdForScope(db: Database, scope: MemoryScope): number | null {
  if (scope.kind === "universal") {
    return null;
  }
  const row = db.query<{ id: number }, [string]>("SELECT id FROM workspace WHERE slug = ?").get(scope.slug);
  return row?.id ?? scope.workspace_id ?? null;
}

async function pageToDoc(db: Database, paths: WardPaths, scope: MemoryScope, relativePage: string): Promise<SearchableDoc> {
  const absolute = join(scopeDir(paths, scope), relativePage);
  const body = await readFile(absolute, "utf8");
  const fileStat = await stat(absolute);
  return SearchableDocSchema.parse({
    doc_id: `wiki:${scopeKey(scope)}:${relativePage}`,
    kind: "wiki",
    scope: scopeKey(scope),
    workspace_id: workspaceIdForScope(db, scope),
    title: titleFrom(relativePage, body),
    body,
    path: gitPath(paths, absolute),
    updated_at: fileStat.mtime.toISOString()
  });
}

async function walkMarkdown(root: string, prefix = ""): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }
  const entries = await readdir(root, { withFileTypes: true });
  const pages: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = join(root, entry.name);
    if (entry.isDirectory()) {
      pages.push(...await walkMarkdown(abs, rel));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      pages.push(rel);
    }
  }
  return pages.sort((a, b) => a.localeCompare(b));
}

function matchQuery(raw: string): string {
  const tokens = raw.match(/[A-Za-z0-9_]+/g) ?? [];
  if (tokens.length === 0) {
    throw new Error("Search query must include at least one word or number.");
  }
  return tokens.map((token) => `${token}*`).join(" OR ");
}

function upsertSearchDocs(db: Database, docs: SearchableDoc[]): void {
  const upsert = db.transaction((items: SearchableDoc[]) => {
    for (const doc of items) {
      const parsed = SearchableDocSchema.parse(doc);
      db.query("DELETE FROM search_document WHERE doc_id = ?").run(parsed.doc_id);
      db.query("DELETE FROM search_document_fts WHERE doc_id = ?").run(parsed.doc_id);
      db.query(`
        INSERT INTO search_document (doc_id, kind, scope, workspace_id, title, body, path, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(parsed.doc_id, parsed.kind, parsed.scope, parsed.workspace_id, parsed.title, parsed.body, parsed.path, parsed.updated_at);
      db.query(`
        INSERT INTO search_document_fts (doc_id, kind, scope, workspace_id, title, body, path, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(parsed.doc_id, parsed.kind, parsed.scope, parsed.workspace_id, parsed.title, parsed.body, parsed.path, parsed.updated_at);
    }
  });
  upsert(docs);
}

async function allWikiDocs(db: Database, paths: WardPaths): Promise<SearchableDoc[]> {
  const docs: SearchableDoc[] = [];
  for (const page of await walkMarkdown(join(paths.memoryDir, "universal"))) {
    docs.push(await pageToDoc(db, paths, { kind: "universal" }, page));
  }
  const workspaces = db.query<{ id: number; slug: string }, []>("SELECT id, slug FROM workspace ORDER BY slug").all();
  for (const workspace of workspaces) {
    const scope: MemoryScope = { kind: "workspace", slug: workspace.slug, workspace_id: workspace.id };
    for (const page of await walkMarkdown(scopeDir(paths, scope))) {
      docs.push(await pageToDoc(db, paths, scope, page));
    }
  }
  return docs;
}

function sessionDocs(db: Database): SearchableDoc[] {
  return db.query<{
    id: string;
    workspace_id: number | null;
    workspace_slug: string | null;
    summary: string;
    ended_at: string | null;
    started_at: string;
  }, []>(`
    SELECT session.id, session.workspace_id, workspace.slug AS workspace_slug, session.summary,
      session.ended_at, session.started_at
    FROM session
    LEFT JOIN workspace ON workspace.id = session.workspace_id
    WHERE session.summary IS NOT NULL AND trim(session.summary) != ''
  `).all().map((row) => SearchableDocSchema.parse({
    doc_id: `session:${row.id}`,
    kind: "session",
    scope: row.workspace_slug ? `workspace/${row.workspace_slug}` : "universal",
    workspace_id: row.workspace_id,
    title: `Session ${row.id}`,
    body: row.summary,
    path: null,
    updated_at: row.ended_at ?? row.started_at
  }));
}

function planPacketDocs(db: Database): SearchableDoc[] {
  return db.query<{
    id: string;
    task_id: string;
    title: string;
    workspace_id: number;
    workspace_slug: string;
    goal: string;
    constraints_json: string;
    acceptance_criteria_json: string;
    file_plan_json: string;
    created_at: string;
  }, []>(`
    SELECT task_contract.id, task_contract.task_id, task.title, task.workspace_id, workspace.slug AS workspace_slug,
      task_contract.goal, task_contract.constraints_json, task_contract.acceptance_criteria_json,
      task_contract.file_plan_json, task_contract.created_at
    FROM task_contract
    JOIN task ON task.id = task_contract.task_id
    JOIN workspace ON workspace.id = task.workspace_id
  `).all().map((row) => SearchableDocSchema.parse({
    doc_id: `plan_packet:${row.id}`,
    kind: "plan_packet",
    scope: `workspace/${row.workspace_slug}`,
    workspace_id: row.workspace_id,
    title: row.title,
    body: [
      row.goal,
      row.constraints_json,
      row.acceptance_criteria_json,
      row.file_plan_json
    ].join("\n\n"),
    path: null,
    updated_at: row.created_at
  }));
}

export async function ensureMemoryBootstrap(paths = resolveWardPaths()): Promise<void> {
  await ensureWardLayout(paths);
  ensureGitAvailable();

  const isNewRepo = !existsSync(join(paths.memoryDir, ".git"));
  if (isNewRepo) {
    const init = git(paths, ["init", "-b", "main"], { allowFailure: true, author: "user" });
    if (init.status !== 0) {
      git(paths, ["init"], { author: "user" });
      git(paths, ["branch", "-M", "main"], { allowFailure: true, author: "user" });
    }
  }

  const changed = await writeSeedFiles(paths);
  if (isNewRepo || changed) {
    commitIfChanged(
      paths,
      ["."],
      "user",
      isNewRepo ? "[user] init memory wiki" : "[user] memory: seed missing wiki pages"
    );
  }
}

export async function ensureWorkspaceWiki(workspace: WorkspaceLike, paths = resolveWardPaths(), db?: Database): Promise<void> {
  await ensureMemoryBootstrap(paths);
  const scope: MemoryScope = { kind: "workspace", slug: workspace.slug, workspace_id: workspace.id };
  const dir = scopeDir(paths, scope);
  let changed = false;
  for (const [page, body] of Object.entries(workspaceSeed(workspace))) {
    changed = await writeIfMissing(join(dir, page), body) || changed;
  }
  await mkdir(join(dir, "plans"), { recursive: true, mode: 0o700 });
  if (changed) {
    commitIfChanged(paths, [gitPath(paths, dir)], "user", `[user] workspace: seed ${workspace.slug}`);
  }
  if (db) {
    await indexWikiScope(db, paths, scope);
  }
}

export async function indexWikiScope(db: Database, paths: WardPaths, scope: MemoryScope): Promise<void> {
  const docs: SearchableDoc[] = [];
  for (const page of await walkMarkdown(scopeDir(paths, scope))) {
    docs.push(await pageToDoc(db, paths, scope, page));
  }
  upsertSearchDocs(db, docs);
}

export async function rebuildSearchIndex(paths = resolveWardPaths()): Promise<void> {
  await withDbPathAsync(paths, async (db) => {
    db.query("DELETE FROM search_document").run();
    db.query("DELETE FROM search_document_fts").run();
    await ensureMemoryBootstrap(paths);
    upsertSearchDocs(db, [
      ...await allWikiDocs(db, paths),
      ...sessionDocs(db),
      ...planPacketDocs(db)
    ]);
  });
}

export class SqliteFts5Search implements SearchBackend {
  constructor(private readonly paths: WardPaths = resolveWardPaths()) {}

  async index(doc: SearchableDoc): Promise<void> {
    await withDbPathAsync(this.paths, async (db) => {
      upsertSearchDocs(db, [doc]);
    });
  }

  async indexBatch(docs: SearchableDoc[]): Promise<void> {
    await withDbPathAsync(this.paths, async (db) => {
      upsertSearchDocs(db, docs);
    });
  }

  async query(q: string, opts: { scope?: string; limit?: number } = {}): Promise<SearchHit[]> {
    const parsed = SearchQuerySchema.parse({ q, scope: opts.scope, limit: opts.limit });
    return withDbPath(this.paths, (db) => {
      const match = matchQuery(parsed.q);
      const params: Array<string | number> = [match];
      let scopeFilter = "";
      if (parsed.scope) {
        scopeFilter = "AND search_document.scope = ?";
        params.push(scopeKey(parseMemoryScope(parsed.scope)));
      }
      params.push(parsed.limit);
      return db.query<{
        doc_id: string;
        kind: "wiki" | "session" | "plan_packet";
        scope: string;
        workspace_id: number | null;
        title: string;
        path: string | null;
        snippet: string | null;
        rank: number;
        updated_at: string;
      }, Array<string | number>>(`
        SELECT search_document.doc_id, search_document.kind, search_document.scope,
          search_document.workspace_id, search_document.title, search_document.path,
          snippet(search_document_fts, 5, '[', ']', ' ... ', 12) AS snippet,
          bm25(search_document_fts) AS rank,
          search_document.updated_at
        FROM search_document_fts
        JOIN search_document ON search_document.doc_id = search_document_fts.doc_id
        WHERE search_document_fts MATCH ? ${scopeFilter}
        ORDER BY rank ASC
        LIMIT ?
      `).all(...params).map((row) => SearchHitSchema.parse({
        ...row,
        snippet: row.snippet ?? ""
      }));
    });
  }

  async rebuild(): Promise<void> {
    await rebuildSearchIndex(this.paths);
  }
}

export class GitBackedLocalMemory implements MemoryBackend {
  constructor(private readonly paths: WardPaths = resolveWardPaths()) {}

  async list(scopeInput: MemoryScope): Promise<MemoryPageSummary[]> {
    await ensureMemoryBootstrap(this.paths);
    const scope = MemoryScopeSchema.parse(scopeInput);
    const pages = await walkMarkdown(scopeDir(this.paths, scope));
    return Promise.all(pages.map(async (page) => {
      const read = await this.read(scope, page);
      const { body: _body, ...summary } = read;
      return MemoryPageSummarySchema.parse(summary);
    }));
  }

  async read(scopeInput: MemoryScope, pageInput: string): Promise<MemoryPage> {
    await ensureMemoryBootstrap(this.paths);
    const scope = MemoryScopeSchema.parse(scopeInput);
    const { absolute, relativePage, gitRelative } = pagePath(this.paths, scope, pageInput);
    if (!existsSync(absolute)) {
      throw new Error(`Wiki page not found: ${scopeKey(scope)}/${relativePage}`);
    }
    const body = await readFile(absolute, "utf8");
    const fileStat = await stat(absolute);
    const lastCommit = (await this.history(scope, relativePage))[0] ?? null;
    return MemoryPageSchema.parse({
      scope: scopeKey(scope),
      page: relativePage,
      title: titleFrom(relativePage, body),
      path: gitRelative,
      updated_at: fileStat.mtime.toISOString(),
      last_author: lastCommit ? authorFromSubject(lastCommit.subject) : null,
      bytes: fileStat.size,
      body
    });
  }

  async write(scopeInput: MemoryScope, pageInput: string, body: string, author: WikiAuthor, summary?: string): Promise<MemoryPage> {
    await ensureMemoryBootstrap(this.paths);
    const scope = MemoryScopeSchema.parse(scopeInput);
    const { absolute, relativePage, gitRelative } = pagePath(this.paths, scope, pageInput);
    const dirty = git(this.paths, ["status", "--porcelain", "--", gitRelative], { author, allowFailure: true }).stdout.trim();
    if (author === "llm" && dirty) {
      withDbPath(this.paths, (db) => recordSystemEvent(db, "wiki.conflict_detected", {
        scope: scopeKey(scope),
        page: relativePage,
        path: gitRelative,
        reason: "Page has pending uncommitted changes."
      }));
      throw new Error(`Wiki conflict detected for ${scopeKey(scope)}/${relativePage}. Refresh context before writing.`);
    }

    await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
    await writeFile(absolute, body, "utf8");
    commitIfChanged(
      this.paths,
      [gitRelative],
      author,
      commitMessage(author, `wiki: update ${scopeKey(scope)}/${relativePage}`, summary)
    );

    await withDbPathAsync(this.paths, async (db) => {
      upsertSearchDocs(db, [await pageToDoc(db, this.paths, scope, relativePage)]);
      recordSystemEvent(db, "wiki.page_written", {
        scope: scopeKey(scope),
        workspace_id: workspaceIdForScope(db, scope),
        page: relativePage,
        author
      });
    });
    return this.read(scope, relativePage);
  }

  async append(scope: MemoryScope, page: string, section: string, author: WikiAuthor, summary?: string): Promise<MemoryPage> {
    const current = await this.read(scope, page).catch(() => null);
    const nextBody = current?.body
      ? `${current.body.trimEnd()}\n\n${section.trim()}\n`
      : `${section.trim()}\n`;
    return this.write(scope, page, nextBody, author, summary ?? `wiki: append ${scopeKey(scope)}/${normalizePage(page)}`);
  }

  async deletePages(scopeInput: MemoryScope, pagesInput: string[], author: WikiAuthor, summary?: string): Promise<string[]> {
    await ensureMemoryBootstrap(this.paths);
    const scope = MemoryScopeSchema.parse(scopeInput);
    const deleted: Array<{ relativePage: string; gitRelative: string }> = [];

    for (const pageInput of pagesInput) {
      const { absolute, relativePage, gitRelative } = pagePath(this.paths, scope, pageInput);
      if (!existsSync(absolute)) {
        continue;
      }
      await rm(absolute, { force: true });
      deleted.push({ relativePage, gitRelative });
    }

    if (deleted.length === 0) {
      return [];
    }

    commitIfChanged(
      this.paths,
      deleted.map((item) => item.gitRelative),
      author,
      commitMessage(author, `wiki: delete ${scopeKey(scope)} pages`, summary)
    );

    await withDbPathAsync(this.paths, async (db) => {
      deleteSearchDocs(db, deleted.map((item) => `wiki:${scopeKey(scope)}:${item.relativePage}`));
      recordSystemEvent(db, "wiki.page_deleted", {
        scope: scopeKey(scope),
        workspace_id: workspaceIdForScope(db, scope),
        pages: deleted.map((item) => item.relativePage),
        author
      });
    });

    return deleted.map((item) => item.relativePage);
  }

  async history(scopeInput: MemoryScope, pageInput: string): Promise<MemoryCommit[]> {
    await ensureMemoryBootstrap(this.paths);
    const scope = MemoryScopeSchema.parse(scopeInput);
    const { gitRelative } = pagePath(this.paths, scope, pageInput);
    const result = git(this.paths, [
      "log",
      "--follow",
      "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s",
      "--",
      gitRelative
    ], { allowFailure: true });
    if (result.status !== 0 || !result.stdout.trim()) {
      return [];
    }
    return result.stdout.trim().split("\n").map((line) => {
      const [hash, author_name, author_email, authored_at, subject] = line.split("\x1f");
      return MemoryCommitSchema.parse({ hash, author_name, author_email, authored_at, subject });
    });
  }

  async snapshot(out: string): Promise<void> {
    await ensureMemoryBootstrap(this.paths);
    git(this.paths, ["archive", "--format=tar", `--output=${out}`, "HEAD"]);
  }
}

export async function listWikiPages(scope: string): Promise<MemoryPageSummary[]> {
  return new GitBackedLocalMemory().list(parseMemoryScope(scope));
}

export async function readWikiPage(scope: string, page: string): Promise<MemoryPage> {
  return new GitBackedLocalMemory().read(parseMemoryScope(scope), page);
}

export async function writeWikiPage(scope: string, page: string, body: string, author: WikiAuthor, summary?: string): Promise<MemoryPage> {
  return new GitBackedLocalMemory().write(parseMemoryScope(scope), page, body, author, summary);
}

export async function appendWikiPage(scope: string, page: string, section: string, author: WikiAuthor, summary?: string): Promise<MemoryPage> {
  return new GitBackedLocalMemory().append(parseMemoryScope(scope), page, section, author, summary);
}

export async function deleteWikiPages(scope: string, pages: string[], author: WikiAuthor, summary?: string): Promise<string[]> {
  return new GitBackedLocalMemory().deletePages(parseMemoryScope(scope), pages, author, summary);
}

export async function wikiPageHistory(scope: string, page: string): Promise<MemoryCommit[]> {
  return new GitBackedLocalMemory().history(parseMemoryScope(scope), page);
}

export async function searchMemory(q: string, opts: { scope?: string; limit?: number } = {}): Promise<SearchHit[]> {
  return new SqliteFts5Search().query(q, opts);
}

function linkedPages(body: string, page: string): string[] {
  const links: string[] = [];
  const baseDir = dirname(page).replaceAll("\\", "/");
  const regex = /\[[^\]]+\]\((?!https?:|mailto:|#)([^)#]+)(?:#[^)]+)?\)/g;
  for (const match of body.matchAll(regex)) {
    const raw = decodeURIComponent(match[1].trim());
    if (!raw || raw.startsWith("/")) {
      continue;
    }
    const candidate = raw.endsWith(".md") ? raw : `${raw}.md`;
    const combined = baseDir === "." ? candidate : `${baseDir}/${candidate}`;
    const parts = combined.replaceAll("\\", "/").split("/").filter(Boolean);
    if (parts.some((part) => part === "." || part === "..")) {
      continue;
    }
    links.push(parts.join("/"));
  }
  return links;
}

function lintFinding(severity: "info" | "warn" | "error", scope: string, page: string, message: string): WikiLintFinding {
  const hash = createHash("sha1").update(`${severity}:${scope}:${page}:${message}`).digest("hex").slice(0, 12);
  return WikiLintFindingSchema.parse({
    id: `lint_${hash}`,
    severity,
    scope,
    page,
    message
  });
}

async function lintScope(paths: WardPaths, scope: MemoryScope): Promise<WikiLintFinding[]> {
  const pages = await walkMarkdown(scopeDir(paths, scope));
  const pageSet = new Set(pages);
  const findings: WikiLintFinding[] = [];
  const indexLinks = new Set<string>();
  const key = scopeKey(scope);

  for (const page of pages) {
    const body = await readFile(join(scopeDir(paths, scope), page), "utf8");
    const links = linkedPages(body, page);
    for (const link of links) {
      if (!pageSet.has(link)) {
        findings.push(lintFinding("error", key, page, `Broken wiki link: ${link}`));
      }
      if (page === "index.md") {
        indexLinks.add(link);
      }
    }
    if (/\bTBD\b/i.test(body)) {
      findings.push(lintFinding("warn", key, page, "Page still contains TBD."));
    }
  }

  for (const page of pages) {
    if (page !== "index.md" && !indexLinks.has(page)) {
      findings.push(lintFinding("warn", key, page, "Page is not linked from index.md."));
    }
  }

  return findings;
}

async function lintScopes(scope?: string): Promise<MemoryScope[]> {
  if (scope) {
    return [parseMemoryScope(scope)];
  }
  return withDb((db) => [
    { kind: "universal" } as MemoryScope,
    ...db.query<{ id: number; slug: string }, []>("SELECT id, slug FROM workspace ORDER BY slug")
      .all()
      .map((workspace) => ({ kind: "workspace" as const, slug: workspace.slug, workspace_id: workspace.id }))
  ]);
}

export async function lintWiki(scope?: string): Promise<WikiLintFinding[]> {
  const paths = resolveWardPaths();
  await ensureMemoryBootstrap(paths);
  const findings: WikiLintFinding[] = [];
  for (const parsedScope of await lintScopes(scope)) {
    findings.push(...await lintScope(paths, parsedScope));
  }
  withDb((db) => recordSystemEvent(db, "system.wiki_lint", {
    scope: scope ?? "all",
    finding_count: findings.length,
    findings
  }));
  return findings;
}

export function checkMemoryGit(paths = resolveWardPaths()): { ok: boolean; detail: string } {
  if (!gitAvailable()) {
    return { ok: false, detail: "git not found on PATH" };
  }
  if (!existsSync(join(paths.memoryDir, ".git"))) {
    return { ok: false, detail: "memory git repo missing; run ward init" };
  }
  const result = git(paths, ["fsck", "--no-progress"], { allowFailure: true });
  if (result.status !== 0) {
    return { ok: false, detail: result.stderr.trim() || "git fsck failed" };
  }
  const head = git(paths, ["rev-parse", "--short", "HEAD"], { allowFailure: true }).stdout.trim();
  return { ok: true, detail: head ? `memory repo OK at ${head}` : "memory repo OK" };
}
