import { existsSync, statSync } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, normalize, resolve as resolvePath, dirname } from "node:path";
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
  McpPolicyPreviewRequestSchema,
  McpScopeSchema,
  McpToolCallRequestSchema,
  OpenGateSchema,
  OrbPlanSchema,
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
  planRequiresConfirmation,
  type HarnessLaunch,
  type HarnessLifecycleState,
  type OrbPlan,
  type OrbStep,
  type RuntimeHealth
} from "@ward/core";
import { ClaudeCliHarnessAdapter, CodexCliHarnessAdapter, StubHarnessAdapter, ollamaChat, probeOpenAiCompatible, streamOllamaChat, type ChatMessage, type RunningHarness } from "@ward/harness";
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
  previewMcpPolicy,
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
  unfreezeMcpServerBreaker,
  updateProfile,
  updateWorkspace,
  warmCacheStats,
  wikiPageHistory,
  writeWikiPage,
  writePort,
  callMcpToolThroughProxy
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

const NAV_VOCAB: Array<{ surface: OrbChatSurface; words: string[]; reply: string }> = [
  { surface: "sessions", words: ["sessions", "session", "runs", "run"], reply: "Opening Sessions." },
  { surface: "workspaces", words: ["workspaces", "workspace", "tasks", "projects"], reply: "Opening Workspaces." },
  { surface: "planning", words: ["planning", "plans", "plan", "plan mode"], reply: "Opening Planning." },
  { surface: "memory", words: ["memory", "wiki", "notes"], reply: "Opening Memory." },
  { surface: "settings", words: ["settings", "preferences", "config", "configuration"], reply: "Opening Settings." },
  { surface: "overview", words: ["overview", "home", "dashboard", "brief"], reply: "Opening Overview." }
];

function matchNavIntent(message: string): { surface: OrbChatSurface; reply: string } | null {
  const trimmed = message.trim().replace(/[.,!?;:]+$/, "").toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 40) return null;
  // Strip leading verb + optional article: "open the X", "show me X", "go to X", "switch to X", "take me to X"
  const stripped = trimmed
    .replace(/^(please\s+)?(open|show|go to|switch to|take me to|navigate to|jump to|see)\s+(me\s+)?(the\s+|a\s+|an\s+)?/, "")
    .replace(/\s+(tab|view|panel|page|screen)$/, "")
    .trim();
  for (const entry of NAV_VOCAB) {
    if (entry.words.includes(stripped)) {
      return { surface: entry.surface, reply: entry.reply };
    }
  }
  return null;
}

type OrbContextOverrides = {
  systemPrompt: string;
  includeWorkspaces: boolean;
  includeTasks: boolean;
  includeSessions: boolean;
  includeWiki: boolean;
  tokenBudget: number;
};

const ORB_CONTEXT_DEFAULTS: OrbContextOverrides = {
  systemPrompt: "",
  includeWorkspaces: true,
  includeTasks: true,
  includeSessions: true,
  includeWiki: false,
  tokenBudget: 800
};

function readOrbContextOverrides(): OrbContextOverrides {
  const prefs = listPreferences();
  const find = (key: string) =>
    prefs.find((p) => p.scope === "global" && p.key === key && p.workspace_id === null);
  const readBool = (key: string, fallback: boolean): boolean => {
    const row = find(key);
    if (!row) return fallback;
    if (typeof row.value_json === "boolean") return row.value_json;
    if (typeof row.value_json === "number") return row.value_json !== 0;
    if (typeof row.value_json === "string") return row.value_json === "true" || row.value_json === "1";
    return fallback;
  };
  const readInt = (key: string, fallback: number, min: number, max: number): number => {
    const row = find(key);
    if (!row) return fallback;
    const n = typeof row.value_json === "number" ? row.value_json : Number(row.value_json);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const readString = (key: string, fallback: string): string => {
    const row = find(key);
    if (!row) return fallback;
    return typeof row.value_json === "string" ? row.value_json : fallback;
  };
  return {
    systemPrompt: readString("orb.system_prompt_override", ORB_CONTEXT_DEFAULTS.systemPrompt),
    includeWorkspaces: readBool("orb.context.include_workspaces", ORB_CONTEXT_DEFAULTS.includeWorkspaces),
    includeTasks: readBool("orb.context.include_tasks", ORB_CONTEXT_DEFAULTS.includeTasks),
    includeSessions: readBool("orb.context.include_sessions", ORB_CONTEXT_DEFAULTS.includeSessions),
    includeWiki: readBool("orb.context.include_wiki", ORB_CONTEXT_DEFAULTS.includeWiki),
    tokenBudget: readInt("orb.context.token_budget", ORB_CONTEXT_DEFAULTS.tokenBudget, 200, 4000)
  };
}

function defaultOrbHeader(): string {
  const profile = getProfile();
  const name = profile.display_name || profile.honorific || "the user";
  const tone = profile.persona_tone ?? "casual";
  return `You are WARD, ${name}'s local peer developer. Tone: ${tone}. Reply in 1-3 short sentences unless asked for more.`;
}

function buildWorkspaceBlock(): string {
  const workspaces = listWorkspaces();
  const active = workspaces[0];
  if (!active) {
    return "Active workspace: (none — ask the user to create or open one).";
  }
  const repo = active.primary_repo_path ? ` (${active.primary_repo_path})` : "";
  return `Active workspace: ${active.name}${repo}.`;
}

function buildTaskBlock(limit: number): string {
  const open = listTasks().filter((task) => {
    return task.status !== "done"
      && task.status !== "canceled"
      && task.status !== "shipped";
  });
  if (open.length === 0) {
    return "Open tasks: (none).";
  }
  const top = open.slice(0, limit).map((task) => `- ${task.id.slice(0, 12)} [${task.priority}] ${task.title}`);
  return `Open tasks (top ${top.length}):\n${top.join("\n")}`;
}

function buildSessionBlock(limit: number): string {
  const sessions = listHarnessSessions({ include_incognito: false }).slice(0, limit);
  if (sessions.length === 0) {
    return "Recent sessions: (none).";
  }
  const lines = sessions.map((s) => {
    const summary = (s.summary ?? "").trim().slice(0, 80);
    return `- ${s.brain_id} · ${s.lifecycle_state}${summary ? ` · ${summary}` : ""}`;
  });
  return `Recent sessions (last ${lines.length}):\n${lines.join("\n")}`;
}

async function buildWikiBlock(): Promise<string | null> {
  const workspaces = listWorkspaces();
  const active = workspaces[0];
  if (!active) return null;
  const scope = `workspace/${active.slug}`;
  try {
    const page = await readWikiPage(scope, "decisions.md");
    const head = (page.body ?? "").trim().slice(0, 200);
    if (!head) return null;
    const history = await wikiPageHistory(scope, "decisions.md").catch(() => []);
    const latest = history[0];
    const tag = latest ? ` (latest commit: ${latest.subject} — ${latest.author_name})` : "";
    return `Latest wiki decisions${tag}:\n${head}`;
  } catch {
    return null;
  }
}

function buildDateBlock(): string {
  const now = new Date();
  const iso = now.toISOString().slice(0, 10);
  const weekday = now.toLocaleDateString("en-US", { weekday: "short" });
  return `Today: ${iso} (${weekday}).`;
}

function buildProfileBlock(): string {
  const profile = getProfile();
  const name = profile.display_name || profile.honorific || "the user";
  const tone = profile.persona_tone ?? "casual";
  return `Profile: ${name} · tone ${tone}.`;
}

function buildClosingNote(): string {
  return "Data is read-only context. For real code edits, tell the user to launch a Sessions run.";
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function clampToBudget(blocks: string[], budget: number): string {
  if (budget <= 0) return blocks[0] ?? "";
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const cost = estimateTokens(block);
    if (i === 0) {
      out.push(block);
      used += cost;
      continue;
    }
    if (used + cost <= budget) {
      out.push(block);
      used += cost;
      continue;
    }
    const remaining = Math.max(0, budget - used);
    if (remaining < 16) break;
    const charBudget = Math.max(0, remaining * 4 - 8);
    if (charBudget <= 0) break;
    const truncated = block.slice(0, charBudget).trimEnd() + "…";
    out.push(truncated);
    break;
  }
  return out.join("\n\n");
}

async function composeOrbSystemPrompt(headerOverride?: string): Promise<string> {
  const overrides = readOrbContextOverrides();
  const explicit = typeof headerOverride === "string" ? headerOverride.trim() : "";
  const persisted = overrides.systemPrompt.trim();
  const header = explicit || persisted || defaultOrbHeader();
  const blocks: string[] = [header];
  if (overrides.includeWorkspaces) blocks.push(buildWorkspaceBlock());
  if (overrides.includeTasks) blocks.push(buildTaskBlock(3));
  if (overrides.includeSessions) blocks.push(buildSessionBlock(3));
  if (overrides.includeWiki) {
    const wiki = await buildWikiBlock();
    if (wiki) blocks.push(wiki);
  }
  blocks.push(buildDateBlock());
  blocks.push(buildProfileBlock());
  blocks.push(buildClosingNote());
  return clampToBudget(blocks, overrides.tokenBudget);
}

const DEFAULT_OPENAI_COMPATIBLE_MODEL = "gemma4:e4b";

function getLocalChatBrain(): { id: string; base_url: string; model: string } | null {
  const registry = getBrainRegistry();
  const brain = registry.brains.find((b) => b.kind === "openai-compatible" && b.enabled && b.base_url);
  if (!brain || !brain.base_url) return null;
  const model = brain.model || DEFAULT_OPENAI_COMPATIBLE_MODEL;
  return { id: brain.id, base_url: brain.base_url, model };
}

type OrbHistoryEntry = { role: "user" | "assistant"; content: string };

async function buildChatMessages(history: OrbHistoryEntry[], userMessage: string): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [{ role: "system", content: await composeOrbSystemPrompt() }];
  for (const turn of history.slice(-8)) {
    if (turn?.role !== "user" && turn?.role !== "assistant") continue;
    if (typeof turn.content !== "string" || turn.content.length === 0) continue;
    messages.push({ role: turn.role, content: turn.content.slice(0, 4000) });
  }
  messages.push({ role: "user", content: userMessage });
  return messages;
}

type OrbChatMode = "auto" | "chat" | "conductor";

const ORB_ACTION_VERBS = /\b(add|launch|create|start|make|kick\s*off|set\s*up|run|build|spin\s*up|assign|delete|update)\b/i;

function streamSseHeaders(): HeadersInit {
  return {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  };
}

function composeOrbConductorPrompt(): string {
  const workspaces = listWorkspaces();
  const workspaceList = workspaces.length === 0
    ? "(none — refuse to plan and ask the user to create a workspace first)"
    : workspaces.map((w) => `- ${w.slug} (${w.name})`).join("\n");
  const registry = getBrainRegistry();
  const brainList = registry.brains
    .filter((b) => b.enabled !== false)
    .map((b) => `- ${b.id}`)
    .join("\n") || "- stub-worker";
  const slugById = new Map<number, string>(workspaces.map((w) => [w.id, w.slug]));
  const openTasks = listTasks().filter((t) => t.status !== "done" && t.status !== "canceled" && t.status !== "shipped");
  const taskList = openTasks.length === 0
    ? "(no open tasks — if the user wants to launch on a task, create one first via create_task in the same plan)"
    : openTasks.slice(0, 12).map((t) => `- ${t.id} [${slugById.get(t.workspace_id) ?? "?"}] ${t.title}`).join("\n");
  return `You are W.A.R.D's orb conductor. The user has asked you to perform a multi-step action.

You MUST reply with a single JSON object (no prose, no code fences) matching this schema:

{
  "intent": "<one short sentence summary>",
  "needs_confirmation": <true|false>,
  "steps": [
    { "kind": "create_task", "args": { "workspace_slug": "<slug>", "title": "<title>", "type": "feature|bug|chore|research", "priority": "low|medium|high|urgent", "description": "<optional>" } },
    { "kind": "launch_session", "args": { "workspace_slug": "<slug>", "task_ref": "$<step-number>.id", "brain_id": "<brain>", "mode": "headless|visible", "goal": "<concrete goal>" } },
    { "kind": "read_overview", "args": {} },
    { "kind": "read_session", "args": { "session_ref": "$<step-number>.session_id" } },
    { "kind": "read_workspace", "args": { "workspace_slug": "<slug>" } }
  ]
}

Rules:
- ONLY emit JSON. No markdown, no explanation, no surrounding text.
- Steps execute in order. To reference a previous step's result, use \`$N.field\` where N is the 1-based step index.
- "task_ref" in launch_session usually points at the previous create_task step: "$1.id".
- Set "needs_confirmation": true whenever the plan launches a session or modifies state in a way the user might want to double-check.
- Pick "workspace_slug" from this exact list of existing workspaces — never invent a slug:
${workspaceList}
- Pick "brain_id" from this list of available brains — never invent a brain id:
${brainList}
- If the user references an existing task (not creating a new one), pick its id from this list — never invent a task id:
${taskList}
- Default brain_id is "claude-code-cli" if the user mentions Claude or "codex-cli" if they mention Codex. Otherwise default to "stub-worker".
- Default mode is "headless".
- Keep "goal" concrete: a single sentence describing what the brain should do, including the file or module if mentioned.
- Use 1–4 steps. Do not chain extra reads unless the user asked for them.

Worked example 1
User: "Add a /health endpoint task to project brief and launch Claude Code on it."
Output:
{"intent":"Add /health endpoint task to brief and launch Claude on it","needs_confirmation":true,"steps":[{"kind":"create_task","args":{"workspace_slug":"brief","title":"Add /health endpoint","type":"feature","priority":"high"}},{"kind":"launch_session","args":{"workspace_slug":"brief","task_ref":"$1.id","brain_id":"claude-code-cli","mode":"headless","goal":"Add a /health endpoint to apps/api/src/index.ts and a passing test."}}]}

Worked example 2
User: "Create a low-priority chore in ward to clean up TODO comments."
Output:
{"intent":"Create chore task in ward to clean up TODO comments","needs_confirmation":false,"steps":[{"kind":"create_task","args":{"workspace_slug":"ward","title":"Clean up TODO comments","type":"chore","priority":"low"}}]}

Worked example 3
User: "What does the brief workspace look like right now?"
Output:
{"intent":"Show the brief workspace summary","needs_confirmation":false,"steps":[{"kind":"read_workspace","args":{"workspace_slug":"brief"}}]}

Now produce the plan for the user's most recent message. JSON only.`;
}

async function classifyOrbIntent(message: string): Promise<OrbChatMode> {
  if (!ORB_ACTION_VERBS.test(message)) {
    return "chat";
  }
  const brain = getLocalChatBrain();
  if (!brain) {
    return "chat";
  }
  try {
    const result = await ollamaChat({
      baseUrl: brain.base_url,
      model: brain.model,
      messages: [
        { role: "system", content: "Classify the next user message. Reply with ONE word: \"conductor\" if it asks W.A.R.D to take a multi-step action (create, launch, assign, configure), or \"chat\" if it is conversational or a question. Output only one word." },
        { role: "user", content: message }
      ],
      temperature: 0,
      max_tokens: 4,
      keep_alive: "60m",
      think: false,
      timeoutMs: 8000
    });
    const word = result.text.trim().toLowerCase().replace(/[^a-z]/g, "");
    return word === "conductor" ? "conductor" : "chat";
  } catch {
    return "chat";
  }
}

function tryExtractJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  const candidate = body.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function generateOrbPlan(messages: ChatMessage[]): Promise<{ plan: OrbPlan } | { error: string; raw: string }> {
  const brain = getLocalChatBrain();
  if (!brain) {
    return { error: "No local OpenAI-compatible brain enabled.", raw: "" };
  }
  const requestOnce = async (msgs: ChatMessage[]): Promise<string> => {
    const result = await ollamaChat({
      baseUrl: brain.base_url,
      model: brain.model,
      messages: msgs,
      temperature: 0.2,
      max_tokens: 768,
      keep_alive: "60m",
      think: false,
      timeoutMs: 60000,
      extra: { format: "json" }
    });
    return result.text;
  };

  let raw = "";
  try {
    raw = await requestOnce(messages);
  } catch (err) {
    return { error: (err as Error).message, raw: "" };
  }
  let extracted = tryExtractJson(raw);
  if (extracted) {
    const parsed = OrbPlanSchema.safeParse(extracted);
    if (parsed.success) return { plan: parsed.data };
  }

  const correction: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: raw },
    { role: "user", content: "That was not valid JSON for the plan schema. Reply again with ONLY a single JSON object that matches the schema. No prose, no code fences." }
  ];
  try {
    raw = await requestOnce(correction);
  } catch (err) {
    return { error: (err as Error).message, raw };
  }
  extracted = tryExtractJson(raw);
  if (extracted) {
    const parsed = OrbPlanSchema.safeParse(extracted);
    if (parsed.success) return { plan: parsed.data };
    return { error: parsed.error.issues.map((i) => i.message).join("; "), raw };
  }
  return { error: "Model output was not valid JSON.", raw };
}

function planHumanSummary(plan: OrbPlan): string {
  const parts: string[] = [];
  for (const [idx, step] of plan.steps.entries()) {
    const n = idx + 1;
    if (step.kind === "create_task") {
      parts.push(`${n}. Create task "${step.args.title}" in ${step.args.workspace_slug}.`);
    } else if (step.kind === "launch_session") {
      parts.push(`${n}. Launch ${step.args.brain_id} (${step.args.mode}) on ${step.args.workspace_slug}.`);
    } else if (step.kind === "read_overview") {
      parts.push(`${n}. Read the overview.`);
    } else if (step.kind === "read_session") {
      parts.push(`${n}. Read session ${step.args.session_ref}.`);
    } else if (step.kind === "read_workspace") {
      parts.push(`${n}. Read workspace ${step.args.workspace_slug}.`);
    }
  }
  return `${plan.intent}\n${parts.join("\n")}`;
}

function validatePlanReferences(plan: OrbPlan): string | null {
  const slugs = new Set(listWorkspaces().map((w) => w.slug));
  const brainIds = new Set(getBrainRegistry().brains.map((b) => b.id));
  for (const [idx, step] of plan.steps.entries()) {
    const n = idx + 1;
    if (step.kind === "create_task" || step.kind === "launch_session" || step.kind === "read_workspace") {
      const slug = step.args.workspace_slug;
      if (!slugs.has(slug)) {
        return `Step ${n} references workspace "${slug}" which does not exist.`;
      }
    }
    if (step.kind === "launch_session") {
      if (!brainIds.has(step.args.brain_id)) {
        return `Step ${n} references brain "${step.args.brain_id}" which is not registered.`;
      }
    }
  }
  return null;
}

function resolveStepRef(ref: string, results: Array<Record<string, unknown>>): string | null {
  const m = ref.match(/^\$(\d+)\.([a-z_][a-z0-9_]*)$/i);
  if (!m) return ref;
  const idx = Number(m[1]) - 1;
  const field = m[2];
  if (!Number.isFinite(idx) || idx < 0 || idx >= results.length) return null;
  const value = results[idx]?.[field];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

async function executeOrbStep(
  step: OrbStep,
  index: number,
  results: Array<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  if (step.kind === "create_task") {
    const task = createTask(CreateTaskSchema.parse({
      workspace_slug: step.args.workspace_slug,
      title: step.args.title,
      description: step.args.description ?? "",
      type: step.args.type,
      priority: step.args.priority,
      source: "user",
      owner: "user"
    }));
    return { id: task.id, title: task.title, workspace_id: task.workspace_id };
  }
  if (step.kind === "launch_session") {
    let taskId: string | undefined;
    if (step.args.task_ref) {
      const resolved = resolveStepRef(step.args.task_ref, results);
      if (!resolved) {
        throw new Error(`Step ${index + 1}: could not resolve task_ref "${step.args.task_ref}".`);
      }
      taskId = resolved;
    }
    const detail = await launchHarnessSession({
      workspace_slug: step.args.workspace_slug,
      task_id: taskId,
      brain_id: step.args.brain_id,
      mode: step.args.mode,
      goal: step.args.goal
    });
    return {
      session_id: detail.session.id,
      lifecycle_state: detail.session.lifecycle_state,
      brain_id: detail.session.brain_id,
      task_id: detail.session.task_id
    };
  }
  if (step.kind === "read_overview") {
    const overview = await getOverview({ reason: "orb.conductor" });
    return {
      greeting: overview.brief.greeting,
      open_tasks: overview.brief.counts.open_tasks,
      active_workspaces: overview.brief.counts.active_workspaces,
      blockers: overview.brief.counts.blockers
    };
  }
  if (step.kind === "read_session") {
    const ref = resolveStepRef(step.args.session_ref, results);
    if (!ref) throw new Error(`Step ${index + 1}: could not resolve session_ref "${step.args.session_ref}".`);
    const detail = await getHarnessSessionDetail(ref);
    return {
      session_id: detail.session.id,
      lifecycle_state: detail.session.lifecycle_state,
      brain_id: detail.session.brain_id
    };
  }
  if (step.kind === "read_workspace") {
    const detail = getWorkspaceDetail(step.args.workspace_slug);
    return {
      slug: detail.workspace.slug,
      name: detail.workspace.name,
      task_count: detail.tasks.length
    };
  }
  throw new Error(`Unknown step kind.`);
}

async function handleOrbConductorPlanStream(
  send: (event: string, data: unknown) => void,
  message: string,
  history: OrbHistoryEntry[],
  traceId: string,
  ts: string
): Promise<void> {
  const messages: ChatMessage[] = [{ role: "system", content: composeOrbConductorPrompt() }];
  for (const turn of history.slice(-6)) {
    if (turn?.role !== "user" && turn?.role !== "assistant") continue;
    if (typeof turn.content !== "string" || turn.content.length === 0) continue;
    messages.push({ role: turn.role, content: turn.content.slice(0, 2000) });
  }
  messages.push({ role: "user", content: message });

  const result = await generateOrbPlan(messages);
  if ("plan" in result) {
    const plan = result.plan;
    const refError = validatePlanReferences(plan);
    if (refError) {
      send("delta", { text: `I drafted a plan but ${refError.charAt(0).toLowerCase() + refError.slice(1)} Try again with a real workspace or brain id.` });
      send("done", { trace_id: traceId, timestamp: ts });
      return;
    }
    const needs = planRequiresConfirmation(plan);
    const human = planHumanSummary(plan);
    send("delta", { text: human });
    send("plan_proposed", {
      plan: { ...plan, needs_confirmation: needs },
      human_summary: human
    });
    send("done", { trace_id: traceId, timestamp: ts, awaits_confirmation: needs });
    return;
  }

  // Plan generation failed twice. Fall back to plain chat for this turn.
  const chatMessages = await buildChatMessages(history, message);
  try {
    const brain = getLocalChatBrain();
    if (!brain) {
      send("error", { message: "No local OpenAI-compatible brain enabled." });
      send("done", { trace_id: traceId, timestamp: ts });
      return;
    }
    for await (const evt of streamOllamaChat({
      baseUrl: brain.base_url,
      model: brain.model,
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: 384,
      keep_alive: "60m",
      think: false,
      timeoutMs: 120000
    })) {
      if (evt.type === "delta") send("delta", { text: evt.text });
      else if (evt.type === "error") send("error", { message: evt.message });
    }
  } catch (err) {
    send("error", { message: (err as Error).message });
  }
  send("done", { trace_id: traceId, timestamp: ts, planner_fallback: true });
}

async function handleOrbChatStream(req: Request): Promise<Response> {
  const body = await readJson(req) as { message?: unknown; history?: unknown; mode?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return json({ ok: false, error: "Message is required." }, 400);
  }
  const history = Array.isArray(body.history) ? (body.history as OrbHistoryEntry[]) : [];
  const requestedMode: OrbChatMode = body.mode === "chat" || body.mode === "conductor" || body.mode === "auto"
    ? body.mode
    : "auto";
  const traceId = createTraceId("orb");
  const ts = new Date().toISOString();

  const nav = matchNavIntent(message);
  if (nav) {
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        send("delta", { text: nav.reply });
        send("done", { trace_id: traceId, timestamp: ts, surface: nav.surface });
        controller.close();
      }
    });
    return new Response(stream, { headers: streamSseHeaders() });
  }

  const brain = getLocalChatBrain();
  if (!brain) {
    return json({
      ok: false,
      error: "No local OpenAI-compatible brain enabled. Enable `local-openai-compatible` in Settings."
    }, 503);
  }

  let mode: OrbChatMode = requestedMode;
  if (mode === "auto") {
    mode = await classifyOrbIntent(message);
  }

  if (mode === "conductor") {
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        try {
          await handleOrbConductorPlanStream(send, message, history, traceId, ts);
        } catch (err) {
          send("error", { message: (err as Error).message });
          send("done", { trace_id: traceId, timestamp: ts });
        }
        controller.close();
      }
    });
    return new Response(stream, { headers: streamSseHeaders() });
  }

  const messages = await buildChatMessages(history, message);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        for await (const evt of streamOllamaChat({
          baseUrl: brain.base_url,
          model: brain.model,
          messages,
          temperature: 0.7,
          max_tokens: 384,
          keep_alive: "60m",
          think: false,
          timeoutMs: 120000
        })) {
          if (evt.type === "delta") send("delta", { text: evt.text });
          else if (evt.type === "error") send("error", { message: evt.message });
        }
      } catch (err) {
        send("error", { message: (err as Error).message });
      }
      send("done", { trace_id: traceId, timestamp: ts });
      controller.close();
    }
  });

  return new Response(stream, { headers: streamSseHeaders() });
}

async function handleOrbConductorExecute(req: Request): Promise<Response> {
  const body = await readJson(req) as { plan?: unknown };
  const parsed = OrbPlanSchema.safeParse(body.plan);
  if (!parsed.success) {
    return json({ ok: false, error: `Invalid plan: ${parsed.error.issues.map((i) => i.message).join("; ")}` }, 400);
  }
  const plan = parsed.data;
  const refError = validatePlanReferences(plan);
  if (refError) {
    return json({ ok: false, error: refError }, 400);
  }
  const traceId = createTraceId("orb-conductor");
  const ts = new Date().toISOString();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const results: Array<Record<string, unknown>> = [];
      const summaries: string[] = [];
      try {
        for (const [idx, step] of plan.steps.entries()) {
          let human: string;
          if (step.kind === "create_task") {
            human = `Creating task "${step.args.title}" in ${step.args.workspace_slug}…`;
          } else if (step.kind === "launch_session") {
            human = `Launching ${step.args.brain_id} session in ${step.args.workspace_slug}…`;
          } else if (step.kind === "read_overview") {
            human = `Reading overview…`;
          } else if (step.kind === "read_session") {
            human = `Reading session ${step.args.session_ref}…`;
          } else {
            human = `Reading workspace ${step.args.workspace_slug}…`;
          }
          send("step_started", { step_index: idx, kind: step.kind, human });
          try {
            const result = await executeOrbStep(step, idx, results);
            results.push(result);
            send("step_completed", { step_index: idx, kind: step.kind, result });
            if (step.kind === "create_task" && typeof result.id === "string") {
              summaries.push(`task ${String(result.id).slice(0, 16)}`);
            } else if (step.kind === "launch_session" && typeof result.session_id === "string") {
              summaries.push(`session ${String(result.session_id).slice(0, 16)}`);
            }
          } catch (err) {
            const message = (err as Error).message;
            send("error", { step_index: idx, kind: step.kind, message });
            send("done", { trace_id: traceId, timestamp: ts });
            controller.close();
            return;
          }
        }
        send("chain_completed", {
          trace_id: traceId,
          summary: summaries.length > 0
            ? `Done: ${summaries.join(", ")}.`
            : `Done: ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}.`,
          results
        });
        send("done", { trace_id: traceId, timestamp: ts });
      } catch (err) {
        send("error", { message: (err as Error).message });
        send("done", { trace_id: traceId, timestamp: ts });
      }
      controller.close();
    }
  });

  return new Response(stream, { headers: streamSseHeaders() });
}

async function handleBrainTestReply(
  brainId: string,
  body: { message?: unknown; system_prompt?: unknown }
): Promise<Response> {
  const registry = getBrainRegistry();
  const brain = registry.brains.find((b) => b.id === brainId);
  if (!brain) return json({ ok: false, error: `Unknown brain: ${brainId}` }, 404);
  if (brain.kind !== "openai-compatible" || !brain.base_url) {
    return json({ ok: false, error: `Brain ${brainId} is not an OpenAI-compatible chat brain.` }, 400);
  }
  const model = brain.model || DEFAULT_OPENAI_COMPATIBLE_MODEL;
  const message = typeof body.message === "string" && body.message.trim().length > 0
    ? body.message.trim()
    : "Reply with one short greeting and your model name.";
  const messages: ChatMessage[] = [];
  if (typeof body.system_prompt === "string") {
    const composed = await composeOrbSystemPrompt(body.system_prompt);
    if (composed.trim().length > 0) {
      messages.push({ role: "system", content: composed });
    }
  }
  messages.push({ role: "user", content: message });
  const startedAt = Date.now();
  try {
    const result = await ollamaChat({
      baseUrl: brain.base_url,
      model,
      messages,
      temperature: 0.7,
      max_tokens: 128,
      keep_alive: "60m",
      think: false,
      timeoutMs: 15000
    });
    return json({
      ok: true,
      brain_id: brainId,
      reply: result.text,
      latency_ms: Date.now() - startedAt
    });
  } catch (err) {
    return json({
      ok: false,
      brain_id: brainId,
      error: (err as Error).message,
      latency_ms: Date.now() - startedAt
    }, 502);
  }
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

    if (parts[0] === "orb" && parts[1] === "chat" && parts[2] === "stream" && req.method === "POST") {
      return handleOrbChatStream(req);
    }

    if (parts[0] === "orb" && parts[1] === "conductor" && parts[2] === "execute" && req.method === "POST") {
      return handleOrbConductorExecute(req);
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

    if (parts[0] === "brains" && parts[1] && parts[2] === "probe" && req.method === "GET") {
      const registry = getBrainRegistry();
      const brain = registry.brains.find((b) => b.id === parts[1]);
      if (!brain) {
        return json({ ok: false, error: `Unknown brain: ${parts[1]}` }, 404);
      }
      if (brain.kind !== "openai-compatible" || !brain.base_url) {
        return json({ ok: false, error: `Brain ${brain.id} is not an OpenAI-compatible brain.` }, 400);
      }
      const expectedModel = brain.model || DEFAULT_OPENAI_COMPATIBLE_MODEL;
      const probe = await probeOpenAiCompatible(brain.base_url, expectedModel);
      return json({
        ok: true,
        brain_id: brain.id,
        base_url: brain.base_url,
        model: expectedModel,
        configured_model: brain.model,
        ...probe
      });
    }

    if (parts[0] === "brains" && parts[1] && parts[2] === "test-reply" && req.method === "POST") {
      const body = await readJson(req) as { message?: unknown; system_prompt?: unknown };
      return handleBrainTestReply(parts[1], body);
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

    if (parts[0] === "quota" && parts[1] === "unfreeze" && req.method === "POST") {
      const body = await readJson(req) as Record<string, unknown>;
      const scope = body.scope ?? "mcp_server";
      const target = typeof body.target === "string" ? body.target : "";
      if (scope !== "mcp_server" || !target) {
        return json({ ok: false, error: "Usage: POST /api/quota/unfreeze { scope: 'mcp_server', target: '<server-id>' }" }, 400);
      }
      return json({ ok: true, breaker: unfreezeMcpServerBreaker(target) });
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

    if (parts[0] === "mcp" && parts[1] === "policy" && req.method === "POST") {
      return json({
        ok: true,
        decision: await previewMcpPolicy(McpPolicyPreviewRequestSchema.parse(await readJson(req)))
      });
    }

    if (parts[0] === "mcp" && parts[1] === "call" && req.method === "POST") {
      return json({
        ok: true,
        call: await callMcpToolThroughProxy(McpToolCallRequestSchema.parse(await readJson(req)))
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

    if (parts[0] === "fs" && parts[1] === "list" && req.method === "GET") {
      const requested = url.searchParams.get("path");
      const target = requested && requested.length > 0 ? requested : homedir();
      const absolute = isAbsolute(target) ? resolvePath(target) : resolvePath(homedir(), target);
      if (!existsSync(absolute)) {
        return json({ ok: false, error: `Path does not exist: ${absolute}` }, 404);
      }
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(absolute);
      } catch (err) {
        return json({ ok: false, error: (err as Error).message }, 400);
      }
      if (!stat.isDirectory()) {
        return json({ ok: false, error: `Not a directory: ${absolute}` }, 400);
      }
      let dirents;
      try {
        dirents = await readdir(absolute, { withFileTypes: true });
      } catch (err) {
        return json({ ok: false, error: (err as Error).message }, 400);
      }
      const entries = dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => ({ name: d.name, abs_path: join(absolute, d.name) }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 500);
      const parent = dirname(absolute);
      return json({
        ok: true,
        path: absolute,
        parent: parent === absolute ? null : parent,
        home: homedir(),
        entries
      });
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
