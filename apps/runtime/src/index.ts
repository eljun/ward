import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import {
  AddArtifactSchema,
  AppendWikiPageSchema,
  BrainBudgetPatchSchema,
  CreateTaskSchema,
  CreateWorkspaceSchema,
  McpAddServerSchema,
  McpDeleteServerSchema,
  McpEditableScopeSchema,
  McpPatchServerSchema,
  McpScopeSchema,
  OpenGateSchema,
  ProfilePatchSchema,
  QaSupervisorInputSchema,
  RecordAgentSignalSchema,
  AnswerPlanSchema,
  RevisePlanSchema,
  SearchQuerySchema,
  SecretSelectorSchema,
  SecretSetSchema,
  SimulateSessionSchema,
  StartPlanSchema,
  TransitionTaskSchema,
  UpdateWorkspaceSchema,
  WARD_VERSION,
  WriteWikiPageSchema,
  createEvent,
  createTraceId,
  inferAttachmentKind,
  type HarnessLaunch,
  type HarnessLifecycleState,
  type RuntimeHealth
} from "@ward/core";
import { ClaudeCliHarnessAdapter, CodexCliHarnessAdapter, StubHarnessAdapter, type RunningHarness } from "@ward/harness";
import {
  acquireInstanceLock,
  addTaskArtifact,
  appendWikiPage,
  appendHarnessEvent,
  createTask,
  createSimulatedSession,
  createWorkspace,
  createLogger,
  clearWorkspacePlans,
  abortPlan,
  answerPlan,
  approvePlan,
  ensureDeviceToken,
  ensureBrainRegistry,
  ensureMemoryBootstrap,
  ensureWardLayout,
  ensurePlanRuntimeWatchers,
  findAvailablePort,
  getCurrentSchemaVersion,
  getProfile,
  getTask,
  getTaskEvents,
  getTaskEvidence,
  getDailyBrief,
  getHandoff,
  getOverview,
  getPlanDetail,
  getWorkspaceByIdOrSlug,
  getWorkspaceDetail,
  generateTasksFromPlan,
  getBrain,
  getBrainBudgetStatus,
  getBrainRegistry,
  getCostForecast,
  getCostLedgerToday,
  getEffectiveMcpConfig,
  claimReadyHarnessSessions,
  getHarnessSession,
  getHarnessSessionDetail,
  ingestAttachmentBuffer,
  ingestAttachmentFromPath,
  isPortAvailable,
  lintWiki,
  listHarnessQueue,
  listHarnessSessions,
  listBrainBudgetStatuses,
  listMcpScopeServers,
  listMcpServerStatuses,
  listQuotaLedger,
  listWikiPages,
  listPreferences,
  listPlans,
  listRepoSnapshots,
  listTasks,
  listWorkspaces,
  openWardDatabase,
  openTaskGate,
  prewarmWarmCache,
  prepareHarnessLaunch,
  publishPlanTasksExternal,
  readWikiPage,
  rebuildSearchIndex,
  readDeviceToken,
  readPort,
  recoverInterruptedHarnessSessions,
  resolveTaskGate,
  resolveRepoRoot,
  resolveWardPaths,
  recordWorkflowAgentSignal,
  runMigrations,
  runMcpDoctor,
  runQaSupervisor,
  searchMemory,
  listSecrets,
  rotateSecret,
  setPreference,
  setSecret,
  setHarnessWorkerPid,
  markHarnessQueueTerminal,
  addMcpServer,
  deleteMcpServer,
  refreshWorkspaceSnapshots,
  recordCostLedgerEntry,
  finalizeHarnessSession,
  revertHarnessSession,
  revisePlan,
  startPlanMode,
  setBrainEnabled,
  setBrainBudgetCaps,
  setBrainRoute,
  patchMcpServer,
  transitionHarnessSession,
  transitionTask,
  unsetSecret,
  updateProfile,
  updateWorkspace,
  warmCacheStats,
  wikiPageHistory,
  writeWikiPage,
  writePort
} from "@ward/memory";

const HOST = "127.0.0.1";
const GLOBAL_HARNESS_CAP = Number(process.env.WARD_HARNESS_GLOBAL_CAP ?? "2");
const stubHarness = new StubHarnessAdapter();
const claudeCliHarness = new ClaudeCliHarnessAdapter();
const codexCliHarness = new CodexCliHarnessAdapter();
const activeHarnesses = new Map<string, RunningHarness>();
const sessionEventSubscribers = new Map<string, Set<(event: unknown) => void>>();
const terminalSubscribers = new Map<string, Set<(data: string) => void>>();
let queueDraining = false;

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
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function asHarnessState(value: unknown): HarnessLifecycleState | null {
  if (typeof value !== "string") {
    return null;
  }
  switch (value) {
    case "queued":
    case "initializing":
    case "implementing":
    case "testing":
    case "creating_artifacts":
    case "awaiting_approval":
    case "done":
    case "failed":
    case "blocked":
    case "canceled":
      return value;
    default:
      return null;
  }
}

function sessionDurationMs(startedAt: string, endedAt: string | null): number {
  if (!endedAt) {
    return 0;
  }
  return Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
}

function recordHarnessCost(sessionId: string): void {
  const session = getHarnessSession(sessionId);
  const brainId = session.brain_id ?? "stub-worker";
  const brain = getBrain(brainId);
  recordCostLedgerEntry({
    brain_id: brainId,
    accounting_mode: brain?.accounting ?? "local",
    trigger: "harness",
    workspace_id: session.workspace_id,
    session_id: session.id,
    trace_id: session.trace_id ?? createTraceId("cost"),
    duration_ms: sessionDurationMs(session.started_at, session.ended_at),
    invocations: 1
  });
}

function harnessForLaunch(launch: HarnessLaunch): {
  kind: string;
  launch(input: HarnessLaunch): Promise<RunningHarness>;
} {
  const brain = getBrain(launch.brain_id);
  if (brain?.kind === "claude" && launch.runtime_kind === "cli") {
    return claudeCliHarness;
  }
  if (brain?.kind === "codex" && launch.runtime_kind === "cli") {
    return codexCliHarness;
  }
  return stubHarness;
}

async function consumeHarness(run: RunningHarness): Promise<void> {
  for await (const event of run.events()) {
    await publishHarnessEvent(run.sessionId, event);
    if (event.event_type === "worker.status") {
      const payload = event.payload as { state?: unknown; detail?: unknown };
      const nextState = asHarnessState(payload.state);
      if (nextState) {
        const current = getHarnessSession(run.sessionId);
        if (current.lifecycle_state !== nextState) {
          await transitionHarnessSession(run.sessionId, nextState, typeof payload.detail === "string" ? payload.detail : undefined);
        }
      }
    }
  }

  const exit = await run.closed;
  activeHarnesses.delete(run.sessionId);
  setHarnessWorkerPid(run.sessionId, null);
  const current = getHarnessSession(run.sessionId);
  if (["done", "failed", "blocked", "canceled"].includes(current.lifecycle_state ?? "")) {
    if (current.summary) {
      return;
    }
    const fallbackSummary = current.lifecycle_state === "done"
      ? "Harness session completed."
      : current.lifecycle_state === "canceled"
        ? "Harness session canceled."
        : current.lifecycle_state === "blocked"
          ? "Harness session blocked."
          : "Harness session failed.";
    await finalizeHarnessSession(run.sessionId, current.lifecycle_state as "done" | "failed" | "blocked" | "canceled", fallbackSummary);
    recordHarnessCost(run.sessionId);
    void drainHarnessQueue();
    return;
  }

  const nextState = exit.exitCode === 0 ? "done" : "failed";
  const summary = exit.exitCode === 0
    ? "Harness session completed."
    : `Harness session failed with exit code ${exit.exitCode ?? "unknown"}.`;
  await finalizeHarnessSession(run.sessionId, nextState, summary);
  recordHarnessCost(run.sessionId);
  void drainHarnessQueue();
}

async function publishHarnessEvent(sessionId: string, event: unknown): Promise<void> {
  await appendHarnessEvent(sessionId, event as Parameters<typeof appendHarnessEvent>[1]);
  const subscribers = sessionEventSubscribers.get(sessionId);
  if (subscribers) {
    for (const send of subscribers) {
      send(event);
    }
  }
  const payload = (event as { event_type?: string; payload?: unknown }).payload as { data?: unknown } | undefined;
  if ((event as { event_type?: string }).event_type === "worker.terminal" && typeof payload?.data === "string") {
    const terminal = terminalSubscribers.get(sessionId);
    if (terminal) {
      for (const send of terminal) {
        send(payload.data);
      }
    }
  }
}

async function startClaimedHarnessSession(sessionId: string): Promise<void> {
  const detail = await getHarnessSessionDetail(sessionId);
  const adapter = harnessForLaunch(detail.launch);
  const run = await adapter.launch(detail.launch);
  activeHarnesses.set(sessionId, run);
  setHarnessWorkerPid(sessionId, run.pid);
  await transitionHarnessSession(sessionId, "initializing", `${adapter.kind} harness spawned.`);
  const session = getHarnessSession(sessionId);
  await publishHarnessEvent(sessionId, createEvent({
    event_type: "agent.invoked",
    trace_id: session.trace_id ?? createTraceId("session"),
    workspace_id: session.workspace_id,
    session_id: sessionId,
    source: "orchestrator",
    payload: {
      brain_id: session.brain_id,
      runtime_kind: session.runtime_kind,
      mode: session.mode,
      adapter_kind: adapter.kind
    }
  }));
  void consumeHarness(run).catch(async (error) => {
    activeHarnesses.delete(sessionId);
    setHarnessWorkerPid(sessionId, null);
    await finalizeHarnessSession(sessionId, "failed", error instanceof Error ? error.message : String(error));
    void drainHarnessQueue();
  });
}

async function drainHarnessQueue(): Promise<void> {
  if (queueDraining) {
    return;
  }
  queueDraining = true;
  try {
    while (activeHarnesses.size < GLOBAL_HARNESS_CAP) {
      const claimed = claimReadyHarnessSessions(GLOBAL_HARNESS_CAP, [...activeHarnesses.keys()]);
      if (claimed.length === 0) {
        break;
      }
      for (const session of claimed) {
        await startClaimedHarnessSession(session.id);
      }
    }
  } finally {
    queueDraining = false;
  }
}

async function launchHarnessSession(body: unknown): Promise<Awaited<ReturnType<typeof getHarnessSessionDetail>>> {
  const prepared = await prepareHarnessLaunch(body);
  await drainHarnessQueue();
  return getHarnessSessionDetail(prepared.session.id);
}

async function cancelHarnessSession(sessionId: string): Promise<Awaited<ReturnType<typeof getHarnessSessionDetail>>> {
  const run = activeHarnesses.get(sessionId);
  if (run) {
    await run.cancel();
    activeHarnesses.delete(sessionId);
  }
  await finalizeHarnessSession(sessionId, "canceled", "Harness session canceled by user.");
  markHarnessQueueTerminal(sessionId, "canceled");
  void drainHarnessQueue();
  return getHarnessSessionDetail(sessionId);
}

function sse(data: unknown): string {
  const eventType = typeof data === "object" && data && "event_type" in data ? String((data as { event_type: unknown }).event_type) : "message";
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function streamSessionEvents(sessionId: string): Promise<Response> {
  const detail = await getHarnessSessionDetail(sessionId);
  const encoder = new TextEncoder();
  let cleanup = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastCoalescedAt = 0;
      let pending: unknown | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const sendNow = (event: unknown) => controller.enqueue(encoder.encode(sse(event)));
      const flush = () => {
        if (pending) {
          sendNow(pending);
          pending = null;
          lastCoalescedAt = Date.now();
        }
        timer = null;
      };
      const send = (event: unknown) => {
        const type = (event as { event_type?: string }).event_type;
        if (type === "worker.message" || type === "worker.terminal" || type === "fs.file_written") {
          const elapsed = Date.now() - lastCoalescedAt;
          if (elapsed < 33) {
            pending = event;
            if (!timer) {
              timer = setTimeout(flush, 33 - elapsed);
            }
            return;
          }
          lastCoalescedAt = Date.now();
        }
        sendNow(event);
      };
      for (const event of detail.events) {
        sendNow(event);
      }
      const subscribers = sessionEventSubscribers.get(sessionId) ?? new Set<(event: unknown) => void>();
      subscribers.add(send);
      sessionEventSubscribers.set(sessionId, subscribers);
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), 15000);
      cleanup = () => {
        clearInterval(heartbeat);
        if (timer) {
          clearTimeout(timer);
        }
        subscribers.delete(send);
      };
    },
    cancel() {
      cleanup();
    }
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive"
    }
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

function readableCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

type OrbChatSurface = "overview" | "workspaces" | "planning" | "sessions" | "memory" | "settings";

type OrbChatReply = {
  reply: string;
  surface: OrbChatSurface;
  suggestions: string[];
  trace_id: string;
  timestamp: string;
};

async function orbChatReply(message: string): Promise<OrbChatReply> {
  const normalized = message.toLowerCase();
  const profile = getProfile();
  const overview = await getOverview();
  const workspaces = listWorkspaces();
  const tasks = listTasks();
  const sessions = listHarnessSessions({ include_incognito: false });
  const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "canceled");
  const activeSessions = sessions.filter((session) => !["done", "failed", "blocked", "canceled"].includes(session.lifecycle_state ?? ""));
  const latestSession = sessions[0] ?? null;
  const greetingName = profile.display_name || profile.honorific || "there";
  const overviewNarration = overview.brief.narration.trim();

  if (/\b(session|sessions|agent|run|running|claude|codex)\b/.test(normalized)) {
    const latest = latestSession
      ? ` Latest session is ${latestSession.brain_id ?? "unknown brain"} in ${latestSession.lifecycle_state ?? "unknown"} state.`
      : " No sessions have been launched yet.";
    return {
      reply: `I found ${readableCount(sessions.length, "session")} and ${readableCount(activeSessions.length, "active run")}.${latest}`,
      surface: "sessions",
      suggestions: ["Open Sessions", "Launch a stub run", "Check agent status"],
      trace_id: createTraceId("orb"),
      timestamp: new Date().toISOString()
    };
  }

  if (/\b(memory|wiki|note|notes|remember|search)\b/.test(normalized)) {
    return {
      reply: `Memory is ready. I can help search wiki pages, inspect preferences, or open the current workspace memory next.`,
      surface: "memory",
      suggestions: ["Open Memory", "Search wiki", "Review preferences"],
      trace_id: createTraceId("orb"),
      timestamp: new Date().toISOString()
    };
  }

  if (/\b(plan|planning|proposal|decision|clarify)\b/.test(normalized)) {
    return {
      reply: `Planning is available. I can help start a Plan Mode packet, review the current decision, or generate tasks from an approved plan.`,
      surface: "planning",
      suggestions: ["Open Planning", "Start plan", "Review decision"],
      trace_id: createTraceId("orb"),
      timestamp: new Date().toISOString()
    };
  }

  if (/\b(task|tasks|workspace|workspaces|attachment|repo)\b/.test(normalized)) {
    return {
      reply: `You have ${readableCount(workspaces.length, "workspace")} and ${readableCount(openTasks.length, "open task")}. I can open the workspace console so you can add tasks, attach files, or refresh code context.`,
      surface: "workspaces",
      suggestions: ["Open Workspaces", "Create task", "Refresh context"],
      trace_id: createTraceId("orb"),
      timestamp: new Date().toISOString()
    };
  }

  if (/\b(setting|settings|profile|voice|tts|theme)\b/.test(normalized)) {
    return {
      reply: `Settings are ready. You can adjust profile, voice, tone, presence, and the local WARD preferences from there.`,
      surface: "settings",
      suggestions: ["Open Settings", "Adjust voice", "Review profile"],
      trace_id: createTraceId("orb"),
      timestamp: new Date().toISOString()
    };
  }

  if (/\b(hi|hello|hey|status|overview|brief|today)\b/.test(normalized)) {
    return {
      reply: overviewNarration || `Hey ${greetingName}, WARD is warm.`,
      surface: "overview",
      suggestions: ["Open Overview", "Speak brief", "Warm cache"],
      trace_id: createTraceId("orb"),
      timestamp: new Date().toISOString()
    };
  }

  return {
    reply: `I heard you. I can route this toward sessions, planning, workspaces, memory, or settings. For the next slice, this reply loop can route into a real Claude or Codex brain.`,
    surface: "overview",
    suggestions: ["Open Overview", "Open Sessions", "Start planning"],
    trace_id: createTraceId("orb"),
    timestamp: new Date().toISOString()
  };
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

    if (parts[0] === "orb" && parts[1] === "chat" && req.method === "POST") {
      const body = await readJson(req) as { message?: unknown };
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) {
        return json({ ok: false, error: "Message is required" }, 400);
      }
      return json({ ok: true, message, ...await orbChatReply(message) });
    }

    if (parts[0] === "preferences" && req.method === "GET") {
      return json({ ok: true, preferences: listPreferences() });
    }

    if (parts[0] === "preferences" && req.method === "PATCH" && parts[1] && parts[2]) {
      const body = await readJson(req) as { value?: unknown; workspace_id?: number };
      return json({ ok: true, preference: setPreference(parts[1] as "global" | "workspace" | "repo", parts[2], body.value, body.workspace_id) });
    }

    if (parts[0] === "brains" && req.method === "GET" && !parts[1]) {
      return json({ ok: true, registry: getBrainRegistry() });
    }

    if (parts[0] === "brains" && parts[1] === "budgets" && req.method === "GET") {
      return json({ ok: true, budgets: listBrainBudgetStatuses(url.searchParams.get("date") ?? undefined) });
    }

    if (parts[0] === "brains" && parts[1] && parts[2] === "budget" && req.method === "GET") {
      return json({ ok: true, budget: getBrainBudgetStatus(parts[1], url.searchParams.get("date") ?? undefined) });
    }

    if (parts[0] === "brains" && parts[1] && parts[2] === "budget" && req.method === "PATCH") {
      return json({ ok: true, budget: setBrainBudgetCaps(parts[1], BrainBudgetPatchSchema.parse(await readJson(req))) });
    }

    if (parts[0] === "brains" && parts[1] && (parts[2] === "enable" || parts[2] === "disable") && req.method === "POST") {
      return json({ ok: true, brain: setBrainEnabled(parts[1], parts[2] === "enable") });
    }

    if (parts[0] === "brains" && parts[1] === "routes" && parts[2] && req.method === "PUT") {
      const body = await readJson(req) as { brain_ids?: unknown };
      const brainIds = Array.isArray(body.brain_ids) ? body.brain_ids.map(String) : [];
      return json({ ok: true, route: setBrainRoute(parts[2], brainIds) });
    }

    if (parts[0] === "cost" && parts[1] === "today" && req.method === "GET") {
      return json({ ok: true, summary: getCostLedgerToday(url.searchParams.get("date") ?? undefined) });
    }

    if (parts[0] === "cost" && parts[1] === "forecast" && req.method === "GET") {
      return json({ ok: true, forecast: getCostForecast() });
    }

    if (parts[0] === "quota" && req.method === "GET") {
      return json({ ok: true, ledger: listQuotaLedger(Number(url.searchParams.get("limit") ?? "50")) });
    }

    if (parts[0] === "secrets" && req.method === "GET" && !parts[1]) {
      const scope = url.searchParams.get("scope") ?? undefined;
      const workspace = url.searchParams.get("workspace") ?? undefined;
      return json({ ok: true, ...await listSecrets({ scope: scope as "global" | "workspace" | undefined, workspace }) });
    }

    if (parts[0] === "secrets" && req.method === "POST" && !parts[1]) {
      return json({ ok: true, secret: await setSecret(SecretSetSchema.parse(await readJson(req))) }, 201);
    }

    if (parts[0] === "secrets" && parts[1] && parts[2] === "rotate" && req.method === "POST") {
      const body = await readJson(req) as Record<string, unknown>;
      return json({ ok: true, secret: await rotateSecret(SecretSetSchema.parse({ ...body, name: parts[1] })) });
    }

    if (parts[0] === "secrets" && parts[1] && req.method === "DELETE" && !parts[2]) {
      const scope = url.searchParams.get("scope") ?? "global";
      const workspace = url.searchParams.get("workspace") ?? undefined;
      return json({ ok: true, secret: await unsetSecret(parts[1], SecretSelectorSchema.parse({ scope, workspace })) });
    }

    if (parts[0] === "mcp" && parts[1] === "effective" && req.method === "GET") {
      const workspace = url.searchParams.get("workspace_id") ?? url.searchParams.get("workspace") ?? undefined;
      const includeRepo = url.searchParams.get("include_repo") !== "false";
      return json({ ok: true, effective: await getEffectiveMcpConfig(workspace, { includeRepo }) });
    }

    if (parts[0] === "mcp" && parts[1] === "servers" && req.method === "GET") {
      const workspace = url.searchParams.get("workspace_id") ?? url.searchParams.get("workspace") ?? undefined;
      return json({ ok: true, servers: listMcpServerStatuses(workspace) });
    }

    if (parts[0] === "mcp" && parts[1] === "doctor" && req.method === "POST") {
      const body = req.headers.get("content-length") === "0" ? {} : await readJson(req).catch(() => ({}));
      const workspace = (body as Record<string, unknown>).workspace ?? url.searchParams.get("workspace_id") ?? url.searchParams.get("workspace") ?? undefined;
      const timeoutMs = Number((body as Record<string, unknown>).timeout_ms ?? url.searchParams.get("timeout_ms") ?? "5000");
      return json({
        ok: true,
        doctor: await runMcpDoctor({
          workspace: workspace === undefined || workspace === null ? undefined : String(workspace),
          timeout_ms: Number.isFinite(timeoutMs) ? timeoutMs : undefined
        })
      });
    }

    if (parts[0] === "mcp" && parts[1] === "scopes" && parts[2] && parts[3] === "servers" && req.method === "GET") {
      const scope = McpScopeSchema.parse(parts[2]);
      return json({ ok: true, ...await listMcpScopeServers(scope, url.searchParams.get("workspace") ?? undefined) });
    }

    if (parts[0] === "mcp" && parts[1] === "scopes" && parts[2] && parts[3] === "servers" && req.method === "POST") {
      const scope = McpEditableScopeSchema.parse(parts[2]);
      const body = await readJson(req) as Record<string, unknown>;
      return json({ ok: true, server: await addMcpServer(McpAddServerSchema.parse({ ...body, scope })) }, 201);
    }

    if (parts[0] === "mcp" && parts[1] === "scopes" && parts[2] && parts[3] === "servers" && parts[4] && req.method === "PATCH") {
      const scope = McpEditableScopeSchema.parse(parts[2]);
      const body = await readJson(req) as Record<string, unknown>;
      return json({ ok: true, server: await patchMcpServer(parts[4], McpPatchServerSchema.parse({ ...body, scope })) });
    }

    if (parts[0] === "mcp" && parts[1] === "scopes" && parts[2] && parts[3] === "servers" && parts[4] && req.method === "DELETE") {
      const scope = McpEditableScopeSchema.parse(parts[2]);
      const body = req.headers.get("content-length") === "0" ? {} : await readJson(req).catch(() => ({}));
      return json({ ok: true, server: await deleteMcpServer(parts[4], McpDeleteServerSchema.parse({ ...(body as Record<string, unknown>), scope })) });
    }

    if (parts[0] === "overview" && req.method === "GET") {
      return json({ ok: true, overview: await getOverview({ reason: "api.overview" }) });
    }

    if (parts[0] === "brief" && req.method === "GET" && (parts[1] === "today" || parts[1] === "yesterday")) {
      return json({ ok: true, brief: await getDailyBrief(parts[1], { reason: `api.brief.${parts[1]}` }) });
    }

    if (parts[0] === "warm" && req.method === "POST" && !parts[1]) {
      return json({ ok: true, stats: await prewarmWarmCache("api.warm") });
    }

    if (parts[0] === "warm" && req.method === "GET" && parts[1] === "stats") {
      return json({ ok: true, stats: await warmCacheStats() });
    }

    if (parts[0] === "handoffs" && parts[1] && req.method === "GET") {
      return json({ ok: true, handoff: await getHandoff(parts[1]) });
    }

    if (parts[0] === "sessions" && req.method === "GET" && !parts[1]) {
      return json({
        ok: true,
        sessions: listHarnessSessions({
          workspace: url.searchParams.get("workspace") ?? undefined,
          state: asHarnessState(url.searchParams.get("state")) ?? undefined,
          include_incognito: url.searchParams.get("include_incognito") === "true"
        })
      });
    }

    if (parts[0] === "queue" && req.method === "GET") {
      return json({
        ok: true,
        queue: listHarnessQueue({
          workspace: url.searchParams.get("workspace") ?? undefined,
          include_incognito: url.searchParams.get("include_incognito") === "true"
        })
      });
    }

    if (parts[0] === "sessions" && req.method === "POST" && !parts[1]) {
      return json({ ok: true, detail: await launchHarnessSession(await readJson(req)) }, 201);
    }

    if (parts[0] === "sessions" && parts[1] === "simulate" && req.method === "POST") {
      return json({ ok: true, ...await createSimulatedSession(SimulateSessionSchema.parse(await readJson(req))) }, 201);
    }

    if (parts[0] === "sessions" && parts[1] && req.method === "GET" && !parts[2]) {
      return json({ ok: true, detail: await getHarnessSessionDetail(parts[1]) });
    }

    if (parts[0] === "sessions" && parts[1] && parts[2] === "events" && req.method === "GET") {
      return await streamSessionEvents(parts[1]);
    }

    if (parts[0] === "sessions" && parts[1] && parts[2] === "cancel" && req.method === "POST") {
      return json({ ok: true, detail: await cancelHarnessSession(parts[1]) });
    }

    if (parts[0] === "sessions" && parts[1] && parts[2] === "revert" && req.method === "POST") {
      return json({ ok: true, detail: await revertHarnessSession(parts[1]) });
    }

    if (parts[0] === "sessions" && parts[1] && parts[2] === "answer-intervention" && req.method === "POST") {
      const body = await readJson(req) as { decision?: string; note?: string };
      const session = getHarnessSession(parts[1]);
      await publishHarnessEvent(parts[1], createEvent({
        event_type: "intervention.answered",
        trace_id: session.trace_id ?? createTraceId("session"),
        workspace_id: session.workspace_id,
        session_id: parts[1],
        source: "user",
        payload: {
          decision: body.decision ?? "noted",
          note: body.note ?? null
        }
      }));
      return json({ ok: true, detail: await getHarnessSessionDetail(parts[1]) });
    }

    if (parts[0] === "plan" && req.method === "GET" && !parts[1]) {
      return json({ ok: true, plans: listPlans(url.searchParams.get("workspace") ?? undefined) });
    }

    if (parts[0] === "plan" && parts[1] && parts[2] === "start" && req.method === "POST") {
      return json({ ok: true, plan: await startPlanMode(parts[1], StartPlanSchema.parse(await readJson(req))) }, 201);
    }

    if (parts[0] === "plan" && parts[1] && parts[2] === "clear" && req.method === "POST") {
      return json({ ok: true, cleared: await clearWorkspacePlans(parts[1]) });
    }

    if (parts[0] === "plan" && parts[1] && req.method === "GET" && !parts[2]) {
      return json({ ok: true, plan: getPlanDetail(parts[1]) });
    }

    if (parts[0] === "plan" && parts[1] && parts[2] === "answer" && req.method === "POST") {
      return json({ ok: true, plan: await answerPlan(parts[1], AnswerPlanSchema.parse(await readJson(req))) });
    }

    if (parts[0] === "plan" && parts[1] && parts[2] === "approve" && req.method === "POST") {
      return json({ ok: true, plan: await approvePlan(parts[1]) });
    }

    if (parts[0] === "plan" && parts[1] && parts[2] === "revise" && req.method === "POST") {
      return json({ ok: true, plan: await revisePlan(parts[1], RevisePlanSchema.parse(await readJson(req))) });
    }

    if (parts[0] === "plan" && parts[1] && parts[2] === "abort" && req.method === "POST") {
      return json({ ok: true, plan: abortPlan(parts[1]) });
    }

    if (parts[0] === "plan" && parts[1] && parts[2] === "generate-tasks" && req.method === "POST") {
      return json({ ok: true, ...await generateTasksFromPlan(parts[1]) }, 201);
    }

    if (parts[0] === "plan" && parts[1] && parts[2] === "publish-tasks-external" && req.method === "POST") {
      return json({ ok: true, result: await publishPlanTasksExternal(parts[1]) });
    }

    if (parts[0] === "repo-snapshots" && req.method === "GET") {
      return json({ ok: true, snapshots: listRepoSnapshots(url.searchParams.get("workspace") ?? undefined) });
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

    if (parts[0] === "workspaces" && parts[1] && parts[2] === "refresh" && req.method === "POST") {
      return json({ ok: true, snapshots: await refreshWorkspaceSnapshots(parts[1]) });
    }

    if (parts[0] === "workspaces" && parts[1] && parts[2] === "repo-snapshots" && req.method === "GET") {
      return json({ ok: true, snapshots: listRepoSnapshots(parts[1]) });
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

    if (parts[0] === "tasks" && parts[1] && parts[2] === "signals" && req.method === "POST") {
      return json({ ok: true, ...await recordWorkflowAgentSignal(parts[1], RecordAgentSignalSchema.parse(await readJson(req))) }, 201);
    }

    if (parts[0] === "tasks" && parts[1] && parts[2] === "qa-review" && req.method === "POST") {
      return json({ ok: true, ...await runQaSupervisor(parts[1], QaSupervisorInputSchema.parse(await readJson(req))) }, 201);
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
  await ensureBrainRegistry(paths);
  await rebuildSearchIndex(paths);
  await prewarmWarmCache("runtime.startup");
  const recoveredSessions = await recoverInterruptedHarnessSessions();
  const planWatcher = await ensurePlanRuntimeWatchers();

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
    clearInterval(planWatcher);
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
      const ptyMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/pty$/);
      if (ptyMatch) {
        const paths = resolveWardPaths();
        const token = await readDeviceToken(paths);
        if (!(await authenticated(req)) && url.searchParams.get("token") !== token) {
          return json({ ok: false, error: "Unauthorized" }, 401);
        }
        if (srv.upgrade(req, { data: { sessionId: decodeURIComponent(ptyMatch[1]) } })) {
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
        const data = ws.data as { sessionId?: string; cleanup?: () => void } | null;
        const sessionId = data?.sessionId;
        if (!sessionId) {
          ws.close(1008, "Missing session id");
          return;
        }
        void getHarnessSessionDetail(sessionId)
          .then((detail) => {
            if (detail.pty_output) {
              ws.send(detail.pty_output);
            }
          })
          .catch((error) => ws.send(`WARD PTY error: ${error instanceof Error ? error.message : String(error)}\n`));
        const subscribers = terminalSubscribers.get(sessionId) ?? new Set<(data: string) => void>();
        const send = (chunk: string) => ws.send(chunk);
        subscribers.add(send);
        terminalSubscribers.set(sessionId, subscribers);
        if (data) {
          data.cleanup = () => subscribers.delete(send);
        }
      },
      message(ws, message) {
        const data = ws.data as { sessionId?: string } | null;
        const sessionId = data?.sessionId;
        const run = sessionId ? activeHarnesses.get(sessionId) : null;
        if (!sessionId || !run) {
          ws.send("WARD PTY is not attached to a running session.\n");
          return;
        }
        void run.write(String(message));
      },
      close(ws) {
        const data = ws.data as { cleanup?: () => void } | null;
        data?.cleanup?.();
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
  logger.write("info", "WARD runtime started", {
    port,
    pid: process.pid,
    recovered_sessions: recoveredSessions.length
  });
  void drainHarnessQueue();
}

if (import.meta.main) {
  await startRuntime();
}
