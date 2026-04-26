import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import {
  AddArtifactSchema,
  AppendWikiPageSchema,
  CreateTaskSchema,
  CreateWorkspaceSchema,
  OpenGateSchema,
  ProfilePatchSchema,
  SearchQuerySchema,
  TransitionTaskSchema,
  UpdateWorkspaceSchema,
  WARD_VERSION,
  WriteWikiPageSchema,
  createEvent,
  createTraceId,
  inferAttachmentKind,
  type RuntimeHealth
} from "@ward/core";
import {
  acquireInstanceLock,
  addTaskArtifact,
  appendWikiPage,
  createTask,
  createWorkspace,
  createLogger,
  ensureDeviceToken,
  ensureMemoryBootstrap,
  ensureWardLayout,
  findAvailablePort,
  getCurrentSchemaVersion,
  getProfile,
  getTask,
  getTaskEvents,
  getTaskEvidence,
  getWorkspaceByIdOrSlug,
  getWorkspaceDetail,
  ingestAttachmentBuffer,
  ingestAttachmentFromPath,
  isPortAvailable,
  lintWiki,
  listWikiPages,
  listPreferences,
  listTasks,
  listWorkspaces,
  openWardDatabase,
  openTaskGate,
  readWikiPage,
  rebuildSearchIndex,
  readDeviceToken,
  readPort,
  resolveTaskGate,
  resolveRepoRoot,
  resolveWardPaths,
  runMigrations,
  searchMemory,
  setPreference,
  transitionTask,
  updateProfile,
  updateWorkspace,
  wikiPageHistory,
  writeWikiPage,
  writePort
} from "@ward/memory";

const HOST = "127.0.0.1";

function contentType(pathname: string): string {
  switch (extname(pathname)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function authenticated(req: Request): Promise<boolean> {
  const paths = resolveWardPaths();
  const token = await readDeviceToken(paths);
  const cookieToken = req.headers.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("ward_device="))
    ?.slice("ward_device=".length);
  return req.headers.get("authorization") === `Bearer ${token}` || cookieToken === token;
}

async function readJson(req: Request): Promise<unknown> {
  if (req.headers.get("content-length") === "0") {
    return {};
  }
  return req.json().catch(() => ({}));
}

function route(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean).slice(1);
}

function wikiRoute(parts: string[]): { scope: string; pageParts: string[] } {
  if (parts[1] === "universal") {
    return { scope: "universal", pageParts: parts.slice(2) };
  }
  if (parts[1] === "workspace" && parts[2]) {
    return { scope: `workspace/${parts[2]}`, pageParts: parts.slice(3) };
  }
  throw new Error("Expected wiki scope: universal or workspace/<slug>");
}

function joinedPage(parts: string[]): string {
  if (parts.length === 0) {
    throw new Error("Wiki page is required.");
  }
  return parts.join("/");
}

async function handleAttachmentUpload(req: Request, workspaceRef: string): Promise<Response> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ ok: false, error: "Missing file field" }, 400);
    }
    const attachment = await ingestAttachmentBuffer(workspaceRef, {
      name: file.name,
      bytes: await file.arrayBuffer(),
      kind: inferAttachmentKind(file.name, file.type),
      mimeType: file.type,
      sourcePath: null
    });
    return json({ ok: true, attachment }, 201);
  }

  const body = await readJson(req) as { path?: string };
  if (!body.path) {
    return json({ ok: false, error: "Expected JSON body with path or multipart file upload" }, 400);
  }
  return json({ ok: true, attachment: await ingestAttachmentFromPath(workspaceRef, body.path) }, 201);
}

async function api(req: Request, startedAt: number, port: number): Promise<Response> {
  const url = new URL(req.url);
  if (!(await authenticated(req))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  if (url.pathname === "/api/health") {
    const paths = resolveWardPaths();
    const db = openWardDatabase(paths);
    try {
      const health: RuntimeHealth = {
        ok: true,
        version: WARD_VERSION,
        pid: process.pid,
        port,
        uptime_ms: Date.now() - startedAt,
        schema_version: getCurrentSchemaVersion(db),
        timestamp: new Date().toISOString(),
        trace_id: createTraceId("health")
      };
      return json(health);
    } finally {
      db.close();
    }
  }

  const parts = route(url);

  try {
    if (parts[0] === "profile" && req.method === "GET") {
      return json({ ok: true, profile: getProfile() });
    }

    if (parts[0] === "profile" && req.method === "PATCH") {
      return json({ ok: true, profile: updateProfile(ProfilePatchSchema.parse(await readJson(req))) });
    }

    if (parts[0] === "preferences" && req.method === "GET") {
      return json({ ok: true, preferences: listPreferences() });
    }

    if (parts[0] === "preferences" && req.method === "PATCH" && parts[1] && parts[2]) {
      const body = await readJson(req) as { value?: unknown; workspace_id?: number };
      return json({ ok: true, preference: setPreference(parts[1] as "global" | "workspace" | "repo", parts[2], body.value, body.workspace_id) });
    }

    if (parts[0] === "search" && req.method === "GET") {
      const parsed = SearchQuerySchema.parse({
        q: url.searchParams.get("q") ?? "",
        scope: url.searchParams.get("scope") ?? undefined,
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined
      });
      return json({ ok: true, hits: await searchMemory(parsed.q, { scope: parsed.scope, limit: parsed.limit }) });
    }

    if (parts[0] === "wiki" && parts[1] === "reindex" && req.method === "POST") {
      await rebuildSearchIndex();
      return json({ ok: true, reindexed: true });
    }

    if (parts[0] === "wiki" && parts[1] === "lint" && req.method === "GET") {
      const findings = await lintWiki(url.searchParams.get("scope") ?? undefined);
      return json({ ok: true, findings });
    }

    if (parts[0] === "wiki") {
      const parsed = wikiRoute(parts);
      if (req.method === "GET" && parsed.pageParts.length === 0) {
        return json({ ok: true, pages: await listWikiPages(parsed.scope) });
      }

      if (req.method === "GET" && parsed.pageParts.at(-1) === "history") {
        return json({ ok: true, commits: await wikiPageHistory(parsed.scope, joinedPage(parsed.pageParts.slice(0, -1))) });
      }

      if (req.method === "GET") {
        return json({ ok: true, page: await readWikiPage(parsed.scope, joinedPage(parsed.pageParts)) });
      }

      if (req.method === "PUT") {
        const body = WriteWikiPageSchema.parse(await readJson(req));
        return json({ ok: true, page: await writeWikiPage(parsed.scope, joinedPage(parsed.pageParts), body.body, body.author, body.summary) });
      }

      if (req.method === "POST" && parsed.pageParts.at(-1) === "append") {
        const body = AppendWikiPageSchema.parse(await readJson(req));
        return json({
          ok: true,
          page: await appendWikiPage(parsed.scope, joinedPage(parsed.pageParts.slice(0, -1)), body.section, body.author, body.summary)
        });
      }
    }

    if (parts[0] === "workspaces" && req.method === "GET" && !parts[1]) {
      return json({ ok: true, workspaces: listWorkspaces() });
    }

    if (parts[0] === "workspaces" && req.method === "POST" && !parts[1]) {
      return json({ ok: true, workspace: await createWorkspace(CreateWorkspaceSchema.parse(await readJson(req))) }, 201);
    }

    if (parts[0] === "workspaces" && parts[1] && req.method === "GET" && !parts[2]) {
      return json({ ok: true, ...getWorkspaceDetail(parts[1]) });
    }

    if (parts[0] === "workspaces" && parts[1] && req.method === "PATCH" && !parts[2]) {
      const workspace = getWorkspaceByIdOrSlug(parts[1]);
      if (!workspace) {
        return json({ ok: false, error: "Workspace not found" }, 404);
      }
      return json({ ok: true, workspace: updateWorkspace(workspace.id, UpdateWorkspaceSchema.parse(await readJson(req))) });
    }

    if (parts[0] === "workspaces" && parts[1] && parts[2] === "attachments" && req.method === "POST") {
      return await handleAttachmentUpload(req, parts[1]);
    }

    if (parts[0] === "tasks" && req.method === "GET" && !parts[1]) {
      return json({ ok: true, tasks: listTasks({ workspace: url.searchParams.get("workspace") ?? undefined }) });
    }

    if (parts[0] === "tasks" && req.method === "POST" && !parts[1]) {
      return json({ ok: true, task: createTask(CreateTaskSchema.parse(await readJson(req))) }, 201);
    }

    if (parts[0] === "tasks" && parts[1] && req.method === "GET" && !parts[2]) {
      return json({ ok: true, ...getTask(parts[1]) });
    }

    if (parts[0] === "tasks" && parts[1] && parts[2] === "transition" && req.method === "POST") {
      return json({ ok: true, task: transitionTask(parts[1], TransitionTaskSchema.parse(await readJson(req))) });
    }

    if (parts[0] === "tasks" && parts[1] && parts[2] === "gates" && req.method === "POST") {
      return json({ ok: true, gate: openTaskGate(parts[1], OpenGateSchema.parse(await readJson(req))) }, 201);
    }

    if (parts[0] === "tasks" && parts[1] && parts[2] === "approve" && req.method === "POST") {
      const body = await readJson(req) as { gate_id?: string; note?: string };
      return json({ ok: true, gate: resolveTaskGate(parts[1], "approved", body) });
    }

    if (parts[0] === "tasks" && parts[1] && parts[2] === "reject" && req.method === "POST") {
      const body = await readJson(req) as { gate_id?: string; note?: string };
      return json({ ok: true, gate: resolveTaskGate(parts[1], "rejected", body) });
    }

    if (parts[0] === "tasks" && parts[1] && parts[2] === "artifacts" && req.method === "POST") {
      return json({ ok: true, artifact: addTaskArtifact(parts[1], AddArtifactSchema.parse(await readJson(req))) }, 201);
    }

    if (parts[0] === "tasks" && parts[1] && parts[2] === "events" && req.method === "GET") {
      return json({ ok: true, events: getTaskEvents(parts[1]) });
    }

    if (parts[0] === "tasks" && parts[1] && parts[2] === "evidence" && req.method === "GET") {
      return json({ ok: true, ...getTaskEvidence(parts[1]) });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.toLowerCase().includes("not found") ? 404 : 400;
    return json({ ok: false, error: message }, status);
  }

  if (url.pathname === "/api/events") {
    const event = createEvent({
      event_type: "runtime.sse_connected",
      trace_id: createTraceId("sse"),
      workspace_id: null,
      session_id: null,
      source: "runtime",
      payload: { status: "connected" }
    });
    return new Response(`event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive"
      }
    });
  }

  return json({ ok: false, error: "Not found" }, 404);
}

async function serveStatic(req: Request, repoRoot: string): Promise<Response> {
  const url = new URL(req.url);
  const paths = resolveWardPaths();
  const token = await readDeviceToken(paths).catch(() => null);
  const staticRoot = join(repoRoot, "apps", "ui", "dist");
  const rawPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const normalized = normalize(rawPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const candidate = join(staticRoot, normalized);
  const fallback = join(staticRoot, "index.html");
  const path = existsSync(candidate) && !candidate.endsWith("/") ? candidate : fallback;

  if (!existsSync(path)) {
    return new Response(
      `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>WARD</title></head>
  <body><main><h1>WARD Runtime</h1><p>Runtime is serving. Build apps/ui for the Vite shell.</p></main></body>
</html>`,
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          ...(token ? { "set-cookie": `ward_device=${token}; Path=/; SameSite=Strict` } : {})
        }
      }
    );
  }

  return new Response(Bun.file(path), {
    headers: {
      "content-type": contentType(path),
      ...(token && path.endsWith("index.html") ? { "set-cookie": `ward_device=${token}; Path=/; SameSite=Strict` } : {})
    }
  });
}

async function choosePort(): Promise<number> {
  const paths = resolveWardPaths();
  const persisted = await readPort(paths);
  if (persisted && (await isPortAvailable(persisted, HOST))) {
    return persisted;
  }
  return findAvailablePort(47730, 47830, HOST);
}

export async function startRuntime(): Promise<void> {
  const paths = resolveWardPaths();
  const repoRoot = resolveRepoRoot();
  await ensureWardLayout(paths);
  await ensureDeviceToken(paths);
  await runMigrations(paths, { repoRoot });
  await ensureMemoryBootstrap(paths);
  await rebuildSearchIndex(paths);

  const lock = acquireInstanceLock(paths);
  const logger = await createLogger(paths);
  const startedAt = Date.now();
  const port = await choosePort();
  let server: ReturnType<typeof Bun.serve> | null = null;

  const shutdown = async (reason: string) => {
    logger.event(createEvent({
      event_type: "runtime.stopping",
      trace_id: createTraceId("runtime"),
      workspace_id: null,
      session_id: null,
      source: "runtime",
      payload: { reason }
    }));
    server?.stop(true);
    lock.release();
    await unlink(paths.portFile).catch(() => undefined);
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  server = Bun.serve({
    hostname: HOST,
    port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws/pty") {
        if (srv.upgrade(req, { data: null })) {
          return undefined;
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      if (url.pathname.startsWith("/api/")) {
        return api(req, startedAt, port);
      }
      return serveStatic(req, repoRoot);
    },
    websocket: {
      open(ws) {
        ws.send(JSON.stringify({ type: "ward.pty_stub", message: "PTY streams land in Task 007." }));
        ws.close(1000, "PTY stub only");
      },
      message() {
        // Task 002 only verifies that the WebSocket route exists.
      }
    }
  });

  await writePort(paths, port);
  const event = createEvent({
    event_type: "runtime.started",
    trace_id: createTraceId("runtime"),
    workspace_id: null,
    session_id: null,
    source: "runtime",
    payload: { version: WARD_VERSION, port, pid: process.pid }
  });
  logger.event(event);
  logger.write("info", "WARD runtime started", { port, pid: process.pid });
}

if (import.meta.main) {
  await startRuntime();
}
