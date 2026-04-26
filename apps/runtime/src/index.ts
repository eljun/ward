import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { WARD_VERSION, createEvent, createTraceId, type RuntimeHealth } from "@ward/core";
import {
  acquireInstanceLock,
  createLogger,
  ensureDeviceToken,
  ensureWardLayout,
  findAvailablePort,
  getCurrentSchemaVersion,
  isPortAvailable,
  openWardDatabase,
  readDeviceToken,
  readPort,
  resolveRepoRoot,
  resolveWardPaths,
  runMigrations,
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
  return req.headers.get("authorization") === `Bearer ${token}`;
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
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  return new Response(Bun.file(path), {
    headers: { "content-type": contentType(path) }
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
