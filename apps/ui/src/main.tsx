import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Boxes, BrainCircuit, Database, LayoutDashboard, Menu, Mic, PanelRight, RefreshCw, Send, Settings, Sparkles, Waypoints, X } from "lucide-react";
import { WardOrb } from "./components/WardOrb";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import "./styles.css";

type Profile = {
  display_name: string;
  honorific: string | null;
  timezone: string;
  persona_tone: string;
  presence_default: string;
  tts_enabled: boolean;
  tts_voice: string | null;
  tts_rate: number;
  tts_pitch: number;
};

type Workspace = {
  id: number;
  name: string;
  slug: string;
  description: string;
  autonomy_level: string;
  status: string;
};

type Attachment = {
  id: string;
  name: string;
  kind: string;
  bytes: number;
  created_at: string;
};

type Task = {
  id: string;
  workspace_id: number;
  title: string;
  status: string;
  lifecycle_phase: string;
  priority: string;
  type: string;
};

type WorkspaceDetail = {
  workspace: Workspace;
  attachments: Attachment[];
  tasks: Task[];
};

type WikiPageSummary = {
  scope: string;
  page: string;
  title: string;
  path: string;
  updated_at: string | null;
  last_author: "user" | "llm" | "system" | null;
  bytes: number;
};

type WikiPage = WikiPageSummary & {
  body: string;
};

type WikiCommit = {
  hash: string;
  author_name: string;
  authored_at: string;
  subject: string;
};

type SearchHit = {
  doc_id: string;
  kind: "wiki" | "session" | "plan_packet";
  scope: string;
  title: string;
  path: string | null;
  snippet: string;
};

type BriefWorkspace = {
  id: number;
  name: string;
  slug: string;
  status: string;
  open_tasks: number;
  blockers: number;
};

type BriefTaskSignal = {
  workspace_slug: string;
  workspace_name: string;
  task_id: string;
  title: string;
  status: string;
  reason: string;
};

type OutcomeRecord = {
  id: string;
  session_id: string;
  status: "completed" | "failed";
  outcome_summary: string;
  handoff: string;
  created_at: string;
};

type Overview = {
  generated_at: string;
  profile: Pick<Profile, "display_name" | "honorific" | "timezone" | "tts_enabled" | "tts_voice" | "tts_rate" | "tts_pitch">;
  brief: {
    greeting: string;
    narration: string;
    local_date: string;
    speak: boolean;
    counts: {
      active_workspaces: number;
      open_tasks: number;
      blockers: number;
      sessions_completed: number;
      sessions_failed: number;
    };
    next_actions: Array<{ workspace_slug: string | null; task_id: string | null; title: string; action: string }>;
  };
  active_workspaces: BriefWorkspace[];
  running_sessions: Array<{ id: string; lifecycle_state: string | null; summary: string | null }>;
  recent_handoffs: OutcomeRecord[];
  blockers: BriefTaskSignal[];
  cache: {
    entries: Array<{ key: string; stale: boolean; refreshed_at: string }>;
    hit_rate: number;
    miss_rate: number;
  };
};

type PlanRoundName = "context" | "proposal" | "critique" | "convergence" | "decision";

type PlanRoundOutput =
  | {
      round: "context";
      participant_id: string;
      acknowledged: boolean;
      clarifying_questions: string[];
      missing_context: string[];
    }
  | {
      round: "proposal";
      participant_id: string;
      approach_name: string;
      summary: string;
      architecture_sketch: string;
      sequence: string[];
      risks: string[];
      effort_estimate: string;
      assumptions: string[];
    }
  | {
      round: "critique";
      participant_id: string;
      reviews: Array<{
        target_participant_id: string;
        strengths: string[];
        weaknesses: string[];
        questions: string[];
      }>;
    }
  | {
      round: "convergence";
      participant_id: string;
      ranking: string[];
      top_pick_rationale: string;
      remaining_concerns: string[];
    };

type PlanPacket = {
  packet_id: string;
  version: number;
  status: "draft" | "waiting_for_user" | "approved" | "superseded" | "aborted";
  title: string;
  summary: string;
  goals: string[];
  risks: Array<{ risk: string; likelihood: "low" | "med" | "high"; mitigation: string }>;
  tasks: Array<{
    title: string;
    description: string;
    acceptance_criteria: string[];
    assignee_hint: string;
    phase: string;
    priority: string;
  }>;
  first_recommended_action: string;
  source: {
    participants: Array<{ brain_id: string; role: string }>;
    round_transcripts: string[];
    attachments_considered: string[];
    repo_snapshot_ref?: string | null;
    convergence_policy?: string;
  };
};

type PlanDetail = {
  session: {
    id: string;
    workspace_slug: string;
    status: "draft" | "waiting_for_user" | "approved" | "superseded" | "aborted";
    current_round: PlanRoundName;
    prompt: string;
    convergence_policy: string;
    clarifying_questions: string[];
    user_answers: string[];
    packet_id: string | null;
    updated_at: string;
  };
  packet: PlanPacket | null;
  rounds: Array<{
    id: string;
    round_index: number;
    round_name: PlanRoundName;
    moderator_summary: string;
    participants_json: PlanRoundOutput[];
    file_path: string;
  }>;
};

type RepoSnapshot = {
  id: string;
  local_path: string;
  branch: string | null;
  head_commit: string | null;
  key_files: string[];
  symbols: Array<{ path: string; name: string; kind: string }>;
  refreshed_at: string;
};

type WardEvent = {
  event_id: string;
  event_type: string;
  trace_id: string;
  timestamp: string;
  workspace_id: number | null;
  session_id: string | null;
  source: string;
  payload: unknown;
};

type HarnessSession = {
  id: string;
  workspace_id: number | null;
  workspace_slug: string | null;
  task_id: string | null;
  task_title: string | null;
  brain_id: string | null;
  runtime_kind: string | null;
  mode: string | null;
  lifecycle_state: string | null;
  queue_state: string | null;
  queue_position: number | null;
  working_dir: string | null;
  summary: string | null;
  incognito: boolean;
  worker_pid: number | null;
  trace_id: string | null;
  scenario: string | null;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
};

type HarnessSessionDetail = {
  session: HarnessSession;
  events: WardEvent[];
  artifacts: string[];
  pty_output: string;
  paths: {
    session_dir: string;
    events_path: string;
    summary_path: string;
  };
};

type BrainConfig = {
  id: string;
  kind: string;
  runtime: string;
  auth: string;
  model: string | null;
  base_url: string | null;
  tags: string[];
  concurrency_cap: number;
  enabled: boolean;
  accounting: string;
  source: string;
};

type BrainRoute = {
  concern: string;
  brain_ids: string[];
  updated_at: string;
};

type BrainRegistry = {
  brains: BrainConfig[];
  routing: BrainRoute[];
};

type CostLedgerSummary = {
  date: string;
  entries: number;
  totals: {
    invocations: number;
    duration_ms: number;
    tokens_in: number;
    tokens_out: number;
    dollars_estimate: number;
  };
  by_brain: Array<{
    brain_id: string;
    accounting_mode: string;
    invocations: number;
    duration_ms: number;
    tokens_in: number;
    tokens_out: number;
    dollars_estimate: number;
  }>;
};

type CostForecast = {
  generated_at: string;
  forecasts: Array<{
    brain_id: string;
    metric: string;
    current: number;
    limit: number | null;
    projected_breach_at: string | null;
    status: string;
  }>;
};

type QuotaLedgerEntry = {
  id: string;
  policy_id: string;
  target: string;
  metric: string;
  amount: number;
  trace_id: string;
  session_id: string | null;
  created_at: string;
};

type CommandView = "overview" | "workspaces" | "planning" | "sessions" | "memory" | "settings";

type OrbChatResponse = {
  message: string;
  reply: string;
  surface: CommandView;
  suggestions: string[];
  trace_id: string;
  timestamp: string;
};

type OrbChatTurn = {
  id: string;
  role: "user" | "ward";
  text: string;
  timestamp: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init?.headers
    }
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? `Request failed with ${response.status}`);
  }
  return data;
}

function encodePathSegments(value: string): string {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function scopePath(scope: string): string {
  if (scope === "universal") {
    return "universal";
  }
  if (scope.startsWith("workspace/")) {
    return `workspace/${encodeURIComponent(scope.slice("workspace/".length))}`;
  }
  return `workspace/${encodeURIComponent(scope)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function firstText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = asText(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function compactJson(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function truncateText(value: string, maxLength = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function brainKindLabel(kind: string): string {
  if (kind === "stub") {
    return "Stub worker";
  }
  if (kind === "claude") {
    return "Claude Code";
  }
  if (kind === "codex") {
    return "Codex CLI";
  }
  if (kind === "local") {
    return "Local model";
  }
  return titleCase(kind);
}

function runtimeLabel(runtime: string | null | undefined): string {
  if (!runtime) {
    return "runtime pending";
  }
  if (runtime === "cli") {
    return "CLI";
  }
  if (runtime === "stub") {
    return "simulated";
  }
  return runtime;
}

function accountingLabel(accounting: string): string {
  if (accounting === "subscription") {
    return "subscription";
  }
  if (accounting === "local") {
    return "local";
  }
  return accounting;
}

function authLabel(auth: string): string {
  if (auth === "api_key") {
    return "API key";
  }
  return titleCase(auth);
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  return `${Math.round(ms / 60000)} min`;
}

function formatDollars(value: number): string {
  return value > 0 ? `$${value.toFixed(4)}` : "$0";
}

function formatMetric(value: number, metric: string): string {
  if (metric === "duration_ms") {
    return formatDuration(value);
  }
  if (metric === "dollars") {
    return formatDollars(value);
  }
  return String(value);
}

function brainDisplayName(brain: BrainConfig | null | undefined, fallbackId?: string | null): string {
  if (!brain) {
    return fallbackId ?? "No brain selected";
  }
  return brainKindLabel(brain.kind);
}

function brainSummary(brain: BrainConfig | null | undefined, fallbackId?: string | null): string {
  if (!brain) {
    return fallbackId ? `${fallbackId} · registry pending` : "Select a brain to launch.";
  }
  return `${brain.id} · ${runtimeLabel(brain.runtime)} · ${accountingLabel(brain.accounting)}`;
}

function stateTone(state: string | null | undefined): string {
  if (state === "done") {
    return "done";
  }
  if (state === "blocked" || state === "awaiting_approval") {
    return "blocked";
  }
  if (state === "failed" || state === "canceled") {
    return "failed";
  }
  if (state === "running" || state === "initializing" || state === "implementing" || state === "testing" || state === "creating_artifacts") {
    return "running";
  }
  return "idle";
}

function stateLabel(state: string | null | undefined): string {
  return state ? titleCase(state) : "Idle";
}

function stateBadgeTone(state: string | null | undefined): React.ComponentProps<typeof Badge>["tone"] {
  const tone = stateTone(state);
  if (tone === "done") {
    return "success";
  }
  if (tone === "blocked") {
    return "warning";
  }
  if (tone === "failed") {
    return "danger";
  }
  if (tone === "running") {
    return "active";
  }
  return "default";
}

function eventSummary(event: WardEvent): string {
  const payload = asRecord(event.payload);
  if (!payload) {
    return truncateText(compactJson(event.payload));
  }

  if (event.event_type === "session.created") {
    const brainId = firstText(payload, ["brain_id"]) ?? "Selected brain";
    const mode = firstText(payload, ["mode"]) ?? "headless";
    return `${brainId} queued in ${mode} mode.`;
  }

  if (event.event_type === "agent.invoked") {
    const adapter = firstText(payload, ["adapter_kind"]) ?? "adapter";
    const brainId = firstText(payload, ["brain_id"]) ?? "brain";
    return `${brainId} launched through ${adapter}.`;
  }

  if (event.event_type === "session.state_changed") {
    const fromState = firstText(payload, ["from_state"]) ?? "new";
    const toState = firstText(payload, ["to_state"]) ?? "updated";
    const detailText = firstText(payload, ["detail"]);
    return `${stateLabel(fromState)} -> ${stateLabel(toState)}${detailText ? `: ${detailText}` : ""}`;
  }

  if (event.event_type === "worker.status") {
    const state = firstText(payload, ["state"]) ?? "status";
    const detailText = firstText(payload, ["detail"]);
    return detailText ? `${stateLabel(state)}: ${detailText}` : stateLabel(state);
  }

  if (event.event_type === "worker.message") {
    return firstText(payload, ["text", "summary", "message"]) ?? "Worker message received.";
  }

  if (event.event_type === "worker.error") {
    return firstText(payload, ["error", "message", "detail"]) ?? "Worker error captured.";
  }

  if (event.event_type === "worker.vendor_event") {
    const rawType = firstText(payload, ["raw_type", "type"]) ?? "vendor event";
    return `Vendor event: ${rawType}`;
  }

  if (event.event_type === "worker.exit") {
    const exitCode = payload.exit_code ?? "unknown";
    const signalCode = payload.signal_code ?? "none";
    return `Process exited with code ${String(exitCode)} and signal ${String(signalCode)}.`;
  }

  if (event.event_type === "watchdog.timeout") {
    return firstText(payload, ["detail", "kind"]) ?? "Watchdog timeout fired.";
  }

  if (event.event_type === "mcp.tool_denied") {
    return firstText(payload, ["tool_name", "name"]) ?? "Tool call denied by policy.";
  }

  if (event.event_type === "mcp.tool_result") {
    return firstText(payload, ["tool_name", "name"]) ?? "Tool call allowed.";
  }

  if (event.event_type === "agent.artifact_written") {
    return firstText(payload, ["note", "path", "file_path"]) ?? "Artifact written.";
  }

  if (event.event_type === "agent.signal" || event.event_type === "agent.qa_reviewed") {
    return firstText(payload, ["summary", "status"]) ?? "Agent signal received.";
  }

  if (event.event_type === "fs.file_written") {
    return firstText(payload, ["relative_path", "file_path", "path"]) ?? "File written.";
  }

  if (event.event_type === "session.reverted") {
    return firstText(payload, ["detail"]) ?? "Session file changes reverted.";
  }

  if (event.event_type === "worker.terminal") {
    return firstText(payload, ["data"]) ?? "Terminal output received.";
  }

  return truncateText(compactJson(event.payload));
}

function preferredVoice(name?: string | null): SpeechSynthesisVoice | null {
  if (!("speechSynthesis" in window)) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  if (name) {
    const selected = voices.find((voice) => voice.name === name);
    if (selected) {
      return selected;
    }
  }
  return voices.find((voice) => voice.name === "Joelle (Enhanced)")
    ?? voices.find((voice) => /^Joelle\b/i.test(voice.name))
    ?? voices.find((voice) => /^(Samantha|Ava|Allison|Susan|Karen|Moira|Daniel|Alex)\b/i.test(voice.name))
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("en"))
    ?? voices[0]
    ?? null;
}

function speak(text: string, profile: Overview["profile"] | null) {
  if (!("speechSynthesis" in window)) {
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = profile?.tts_rate ?? 1;
  utterance.pitch = profile?.tts_pitch ?? 1;
  const voice = preferredVoice(profile?.tts_voice);
  if (voice) {
    utterance.voice = voice;
  }
  window.speechSynthesis.speak(utterance);
}

function participantSummary(output: PlanRoundOutput): string {
  if (output.round === "context") {
    return output.clarifying_questions[0] ?? "Context acknowledged.";
  }
  if (output.round === "proposal") {
    return output.summary;
  }
  if (output.round === "critique") {
    return output.reviews.flatMap((review) => review.weaknesses).slice(0, 2).join(" ") || "No blocking critique.";
  }
  return output.top_pick_rationale;
}

function participantMeta(output: PlanRoundOutput): string {
  if (output.round === "proposal") {
    return `${output.approach_name} · ${output.effort_estimate}`;
  }
  if (output.round === "critique") {
    return `${output.reviews.length} reviews`;
  }
  if (output.round === "convergence") {
    return `ranked ${output.ranking.join(", ")}`;
  }
  return output.acknowledged ? "acknowledged" : "pending";
}

function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [memoryScope, setMemoryScope] = useState("universal");
  const [wikiPages, setWikiPages] = useState<WikiPageSummary[]>([]);
  const [selectedPage, setSelectedPage] = useState("");
  const [wikiPage, setWikiPage] = useState<WikiPage | null>(null);
  const [wikiBody, setWikiBody] = useState("");
  const [commits, setCommits] = useState<WikiCommit[]>([]);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [plans, setPlans] = useState<PlanDetail[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [planDetail, setPlanDetail] = useState<PlanDetail | null>(null);
  const [repoSnapshots, setRepoSnapshots] = useState<RepoSnapshot[]>([]);
  const [planBusy, setPlanBusy] = useState<"" | "start" | "clear" | "answer" | "approve" | "revise" | "generate" | "refresh-context">("");
  const [sessions, setSessions] = useState<HarnessSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [sessionDetail, setSessionDetail] = useState<HarnessSessionDetail | null>(null);
  const [sessionBusy, setSessionBusy] = useState<"" | "launch" | "cancel" | "refresh">("");
  const [terminalInput, setTerminalInput] = useState("");
  const [brainRegistry, setBrainRegistry] = useState<BrainRegistry>({ brains: [], routing: [] });
  const [costSummary, setCostSummary] = useState<CostLedgerSummary | null>(null);
  const [costForecast, setCostForecast] = useState<CostForecast | null>(null);
  const [quotaLedger, setQuotaLedger] = useState<QuotaLedgerEntry[]>([]);
  const [brainBusy, setBrainBusy] = useState("");
  const [activeView, setActiveView] = useState<CommandView>("overview");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [orbPulse, setOrbPulse] = useState(0);
  const [chatText, setChatText] = useState("");
  const [orbBusy, setOrbBusy] = useState(false);
  const [orbTurns, setOrbTurns] = useState<OrbChatTurn[]>([]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.slug === selectedSlug) ?? null,
    [selectedSlug, workspaces]
  );
  const enabledBrains = useMemo(
    () => brainRegistry.brains.filter((brain) => brain.enabled),
    [brainRegistry.brains]
  );
  const selectedSession = sessionDetail?.session ?? null;
  const selectedSessionBrain = useMemo(
    () => selectedSession?.brain_id
      ? brainRegistry.brains.find((brain) => brain.id === selectedSession.brain_id) ?? null
      : null,
    [brainRegistry.brains, selectedSession?.brain_id]
  );
  const brainById = useMemo(
    () => new Map(brainRegistry.brains.map((brain) => [brain.id, brain])),
    [brainRegistry.brains]
  );
  const costByBrain = useMemo(
    () => new Map((costSummary?.by_brain ?? []).map((row) => [row.brain_id, row])),
    [costSummary?.by_brain]
  );
  const forecastByBrain = useMemo(
    () => new Map((costForecast?.forecasts ?? []).map((forecast) => [forecast.brain_id, forecast])),
    [costForecast?.forecasts]
  );
  const latestSessionIssue = useMemo(
    () => [...(sessionDetail?.events ?? [])].reverse().find((event) => {
      const payload = asRecord(event.payload);
      const payloadState = payload ? firstText(payload, ["state", "to_state"]) : null;
      return event.event_type === "worker.error"
        || event.event_type === "watchdog.timeout"
        || payloadState === "blocked"
        || payloadState === "failed";
    }) ?? null,
    [sessionDetail?.events]
  );
  const latestAssistantMessage = useMemo(
    () => [...(sessionDetail?.events ?? [])].reverse().find((event) => {
      const payload = asRecord(event.payload);
      return event.event_type === "worker.message" && Boolean(payload && firstText(payload, ["text", "summary", "message"]));
    }) ?? null,
    [sessionDetail?.events]
  );

  async function refreshBrainSurface() {
    const [brainResponse, costResponse, forecastResponse, quotaResponse] = await Promise.all([
      api<{ registry: BrainRegistry }>("/api/brains"),
      api<{ summary: CostLedgerSummary }>("/api/cost/today"),
      api<{ forecast: CostForecast }>("/api/cost/forecast"),
      api<{ ledger: QuotaLedgerEntry[] }>("/api/quota?limit=8")
    ]);
    setBrainRegistry(brainResponse.registry);
    setCostSummary(costResponse.summary);
    setCostForecast(forecastResponse.forecast);
    setQuotaLedger(quotaResponse.ledger);
  }

  async function refresh() {
    setError("");
    const [profileResponse, workspaceResponse, taskResponse, overviewResponse] = await Promise.all([
      api<{ profile: Profile }>("/api/profile"),
      api<{ workspaces: Workspace[] }>("/api/workspaces"),
      api<{ tasks: Task[] }>("/api/tasks"),
      api<{ overview: Overview }>("/api/overview")
    ]);
    setProfile(profileResponse.profile);
    setWorkspaces(workspaceResponse.workspaces);
    setTasks(taskResponse.tasks);
    setOverview(overviewResponse.overview);
    await refreshBrainSurface();
    if (!selectedSlug && workspaceResponse.workspaces[0]) {
      setSelectedSlug(workspaceResponse.workspaces[0].slug);
    }
  }

  async function refreshDetail(slug: string) {
    if (!slug) {
      setDetail(null);
      return;
    }
    const response = await api<WorkspaceDetail>(`/api/workspaces/${slug}`);
    setDetail(response);
  }

  async function readPlan(planId: string) {
    const response = await api<{ plan: PlanDetail }>(`/api/plan/${encodeURIComponent(planId)}`);
    setPlanDetail(response.plan);
    setSelectedPlanId(response.plan.packet?.packet_id ?? response.plan.session.id);
  }

  async function refreshPlanSurface(slug = selectedSlug, preferredPlanId = selectedPlanId) {
    if (!slug) {
      setPlans([]);
      setSelectedPlanId("");
      setPlanDetail(null);
      setRepoSnapshots([]);
      return;
    }

    const planResponse = await api<{ plans: PlanDetail[] }>(`/api/plan?workspace=${encodeURIComponent(slug)}`);
    setPlans(planResponse.plans);
    const nextPlanId = planResponse.plans.find((plan) => (plan.packet?.packet_id ?? plan.session.id) === preferredPlanId)
      ? preferredPlanId
      : planResponse.plans[0]
        ? planResponse.plans[0].packet?.packet_id ?? planResponse.plans[0].session.id
        : "";
    setSelectedPlanId(nextPlanId);
    if (nextPlanId) {
      const selected = planResponse.plans.find((plan) => (plan.packet?.packet_id ?? plan.session.id) === nextPlanId);
      setPlanDetail(selected ?? null);
    } else {
      setPlanDetail(null);
    }

    const snapshotResponse = await api<{ snapshots: RepoSnapshot[] }>(`/api/workspaces/${encodeURIComponent(slug)}/repo-snapshots`)
      .catch(() => ({ snapshots: [] }));
    setRepoSnapshots(snapshotResponse.snapshots);
  }

  async function readSession(sessionId: string) {
    const response = await api<{ detail: HarnessSessionDetail }>(`/api/sessions/${encodeURIComponent(sessionId)}`);
    setSessionDetail(response.detail);
    setSelectedSessionId(response.detail.session.id);
  }

  async function refreshSessionSurface(slug = selectedSlug, preferredSessionId = selectedSessionId) {
    if (!slug) {
      setSessions([]);
      setSelectedSessionId("");
      setSessionDetail(null);
      return;
    }
    const response = await api<{ sessions: HarnessSession[] }>(`/api/sessions?workspace=${encodeURIComponent(slug)}`);
    setSessions(response.sessions);
    const nextSessionId = response.sessions.some((session) => session.id === preferredSessionId)
      ? preferredSessionId
      : response.sessions[0]?.id ?? "";
    setSelectedSessionId(nextSessionId);
    if (nextSessionId) {
      await readSession(nextSessionId);
    } else {
      setSessionDetail(null);
    }
  }

  async function readMemoryPage(scope: string, page: string) {
    const response = await api<{ page: WikiPage }>(`/api/wiki/${scopePath(scope)}/${encodePathSegments(page)}`);
    setSelectedPage(response.page.page);
    setWikiPage(response.page);
    setWikiBody(response.page.body);
    const history = await api<{ commits: WikiCommit[] }>(`/api/wiki/${scopePath(scope)}/${encodePathSegments(response.page.page)}/history`);
    setCommits(history.commits.slice(0, 5));
  }

  async function refreshMemory(scope = memoryScope, preferredPage = selectedPage) {
    const response = await api<{ pages: WikiPageSummary[] }>(`/api/wiki/${scopePath(scope)}`);
    setWikiPages(response.pages);
    const nextPage = response.pages.find((page) => page.page === preferredPage)?.page ?? response.pages[0]?.page ?? "";
    if (nextPage) {
      await readMemoryPage(scope, nextPage);
    } else {
      setSelectedPage("");
      setWikiPage(null);
      setWikiBody("");
      setCommits([]);
    }
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      return;
    }
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  useEffect(() => {
    refreshDetail(selectedSlug).catch((err) => setError(err.message));
    refreshPlanSurface(selectedSlug).catch((err) => setError(err.message));
    refreshSessionSurface(selectedSlug).catch((err) => setError(err.message));
  }, [selectedSlug]);

  useEffect(() => {
    refreshMemory(memoryScope, "").catch((err) => setError(err.message));
  }, [memoryScope]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }
    const source = new EventSource(`/api/sessions/${encodeURIComponent(selectedSessionId)}/events`);
    const eventNames = [
      "session.created",
      "session.state_changed",
      "worker.status",
      "worker.message",
      "worker.terminal",
      "worker.tool_call",
      "worker.error",
      "worker.vendor_event",
      "worker.exit",
      "watchdog.timeout",
      "mcp.tool_denied",
      "mcp.tool_result",
      "agent.artifact_written",
      "agent.signal",
      "agent.qa_reviewed",
      "fs.file_written",
      "session.reverted",
      "intervention.answered"
    ];
    const handler = (event: MessageEvent) => {
      const parsed = JSON.parse(event.data) as WardEvent;
      setSessionDetail((current) => {
        if (!current || current.session.id !== selectedSessionId || current.events.some((item) => item.event_id === parsed.event_id)) {
          return current;
        }
        return {
          ...current,
          events: [...current.events, parsed],
          pty_output: parsed.event_type === "worker.terminal" && typeof (parsed.payload as { data?: unknown }).data === "string"
            ? `${current.pty_output}${(parsed.payload as { data: string }).data}`
            : current.pty_output
        };
      });
    };
    for (const name of eventNames) {
      source.addEventListener(name, handler);
    }
    source.onerror = () => source.close();
    return () => source.close();
  }, [selectedSessionId]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await api<{ profile: Profile }>("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({
        display_name: String(form.get("display_name") ?? ""),
        timezone: String(form.get("timezone") ?? "UTC"),
        persona_tone: String(form.get("persona_tone") ?? "casual"),
        presence_default: String(form.get("presence_default") ?? "present"),
        tts_enabled: form.get("tts_enabled") === "on",
        tts_voice: String(form.get("tts_voice") ?? "") || null,
        tts_rate: Number(form.get("tts_rate") ?? 1),
        tts_pitch: Number(form.get("tts_pitch") ?? 1)
      })
    });
    setProfile(response.profile);
    setOverview((current) => current ? {
      ...current,
      profile: {
        ...current.profile,
        tts_enabled: response.profile.tts_enabled,
        tts_voice: response.profile.tts_voice,
        tts_rate: response.profile.tts_rate,
        tts_pitch: response.profile.tts_pitch,
        display_name: response.profile.display_name,
        timezone: response.profile.timezone
      }
    } : current);
    setMessage("Profile saved.");
  }

  async function toggleBrain(brainId: string, enabled: boolean) {
    setBrainBusy(`brain:${brainId}`);
    try {
      await api(`/api/brains/${encodeURIComponent(brainId)}/${enabled ? "enable" : "disable"}`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setMessage(`${brainId} ${enabled ? "enabled" : "disabled"}.`);
      await refreshBrainSurface();
    } finally {
      setBrainBusy("");
    }
  }

  async function saveBrainRoute(event: FormEvent<HTMLFormElement>, concern: string) {
    event.preventDefault();
    const select = event.currentTarget.elements.namedItem("brain_ids");
    const brainIds = select instanceof HTMLSelectElement
      ? Array.from(select.selectedOptions).map((option) => option.value)
      : [];
    if (brainIds.length === 0) {
      setError("Select at least one brain for this route.");
      return;
    }
    setBrainBusy(`route:${concern}`);
    try {
      await api(`/api/brains/routes/${encodeURIComponent(concern)}`, {
        method: "PUT",
        body: JSON.stringify({ brain_ids: brainIds })
      });
      setMessage(`${titleCase(concern)} route updated.`);
      await refreshBrainSurface();
    } finally {
      setBrainBusy("");
    }
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
        repo: String(form.get("repo") ?? "") || undefined
      })
    });
    event.currentTarget.reset();
    setMessage("Workspace created.");
    await refresh();
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWorkspace) {
      return;
    }
    const form = new FormData(event.currentTarget);
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        workspace_slug: selectedWorkspace.slug,
        title: String(form.get("title") ?? ""),
        priority: String(form.get("priority") ?? "medium"),
        type: String(form.get("type") ?? "feature")
      })
    });
    event.currentTarget.reset();
    setMessage("Task created.");
    await refresh();
    await refreshDetail(selectedWorkspace.slug);
  }

  async function uploadAttachment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWorkspace) {
      return;
    }
    const form = new FormData(event.currentTarget);
    await api(`/api/workspaces/${selectedWorkspace.slug}/attachments`, {
      method: "POST",
      body: form
    });
    event.currentTarget.reset();
    setMessage("Attachment ingested.");
    await refreshDetail(selectedWorkspace.slug);
  }

  function activePlanRef(): string {
    return planDetail?.packet?.packet_id ?? planDetail?.session.id ?? selectedPlanId;
  }

  async function startPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWorkspace) {
      return;
    }
    setPlanBusy("start");
    const form = new FormData(event.currentTarget);
    const prompt = String(form.get("prompt") ?? "").trim();
    try {
      const response = await api<{ plan: PlanDetail }>(`/api/plan/${encodeURIComponent(selectedWorkspace.slug)}/start`, {
        method: "POST",
        body: JSON.stringify({
          prompt: prompt || undefined,
          convergence_policy: String(form.get("policy") ?? "consensus"),
          force_clarification: form.get("clarify") === "on"
        })
      });
      const nextId = response.plan.packet?.packet_id ?? response.plan.session.id;
      event.currentTarget.reset();
      setSelectedPlanId(nextId);
      setPlanDetail(response.plan);
      setMessage(response.plan.session.status === "waiting_for_user" ? "Plan Mode is waiting for your answer." : "Plan packet drafted.");
      await refreshPlanSurface(selectedWorkspace.slug, nextId);
    } finally {
      setPlanBusy("");
    }
  }

  async function answerPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const planId = activePlanRef();
    if (!planId) {
      return;
    }
    setPlanBusy("answer");
    const form = new FormData(event.currentTarget);
    const answer = String(form.get("answer") ?? "").trim();
    if (!answer) {
      setPlanBusy("");
      return;
    }
    try {
      const response = await api<{ plan: PlanDetail }>(`/api/plan/${encodeURIComponent(planId)}/answer`, {
        method: "POST",
        body: JSON.stringify({ answer })
      });
      const nextId = response.plan.packet?.packet_id ?? response.plan.session.id;
      event.currentTarget.reset();
      setSelectedPlanId(nextId);
      setPlanDetail(response.plan);
      setMessage("Plan Mode answer recorded.");
      await refreshPlanSurface(selectedSlug, nextId);
    } finally {
      setPlanBusy("");
    }
  }

  async function approvePlanPacket() {
    const planId = activePlanRef();
    if (!planId) {
      return;
    }
    setPlanBusy("approve");
    try {
      const response = await api<{ plan: PlanDetail }>(`/api/plan/${encodeURIComponent(planId)}/approve`, {
        method: "POST",
        body: JSON.stringify({})
      });
      const nextId = response.plan.packet?.packet_id ?? response.plan.session.id;
      setSelectedPlanId(nextId);
      setPlanDetail(response.plan);
      setMessage("Plan approved and written to wiki memory.");
      await refreshPlanSurface(selectedSlug, nextId);
      const scope = `workspace/${response.plan.session.workspace_slug}`;
      setMemoryScope(scope);
      await refreshMemory(scope, `plans/${nextId}.md`).catch(() => undefined);
    } finally {
      setPlanBusy("");
    }
  }

  async function revisePlanPacket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const planId = activePlanRef();
    if (!planId) {
      return;
    }
    setPlanBusy("revise");
    const form = new FormData(event.currentTarget);
    const notes = String(form.get("notes") ?? "").trim();
    if (!notes) {
      setPlanBusy("");
      return;
    }
    try {
      const response = await api<{ plan: PlanDetail }>(`/api/plan/${encodeURIComponent(planId)}/revise`, {
        method: "POST",
        body: JSON.stringify({ notes })
      });
      const nextId = response.plan.packet?.packet_id ?? response.plan.session.id;
      event.currentTarget.reset();
      setSelectedPlanId(nextId);
      setPlanDetail(response.plan);
      setMessage("Plan revision drafted.");
      await refreshPlanSurface(selectedSlug, nextId);
    } finally {
      setPlanBusy("");
    }
  }

  async function generatePlanTasks() {
    const planId = activePlanRef();
    if (!planId) {
      return;
    }
    setPlanBusy("generate");
    try {
      await api(`/api/plan/${encodeURIComponent(planId)}/generate-tasks`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setMessage("Plan tasks generated.");
      await refresh();
      await refreshDetail(selectedSlug);
      await refreshPlanSurface(selectedSlug, planId);
    } finally {
      setPlanBusy("");
    }
  }

  async function refreshCodeContext() {
    if (!selectedWorkspace) {
      return;
    }
    setPlanBusy("refresh-context");
    try {
      const response = await api<{ snapshots: RepoSnapshot[] }>(`/api/workspaces/${encodeURIComponent(selectedWorkspace.slug)}/refresh`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setRepoSnapshots(response.snapshots);
      setMessage("Workspace code context refreshed.");
    } finally {
      setPlanBusy("");
    }
  }

  async function clearPlans() {
    if (!selectedWorkspace) {
      return;
    }
    const confirmed = window.confirm(`Clear all Plan Mode history for ${selectedWorkspace.name}? Generated tasks will stay in place.`);
    if (!confirmed) {
      return;
    }
    setPlanBusy("clear");
    try {
      await api(`/api/plan/${encodeURIComponent(selectedWorkspace.slug)}/clear`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setSelectedPlanId("");
      setPlanDetail(null);
      setMessage("Workspace plans cleared.");
      await refreshPlanSurface(selectedWorkspace.slug, "");
      await refreshMemory(memoryScope, "").catch(() => undefined);
    } finally {
      setPlanBusy("");
    }
  }

  async function launchSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWorkspace) {
      return;
    }
    setSessionBusy("launch");
    const form = new FormData(event.currentTarget);
    const taskId = String(form.get("task_id") ?? "");
    const scenario = String(form.get("scenario") ?? "default");
    const brainId = String(form.get("brain_id") ?? "stub-worker");
    try {
      const response = await api<{ detail: HarnessSessionDetail }>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          workspace_slug: selectedWorkspace.slug,
          task_id: taskId || undefined,
          brain_id: brainId,
          mode: String(form.get("mode") ?? "headless"),
          scenario,
          goal: String(form.get("goal") ?? "") || undefined,
          idle_max_ms: scenario === "idle-timeout" ? 200 : undefined
        })
      });
      const nextId = response.detail.session.id;
      setSelectedSessionId(nextId);
      setSessionDetail(response.detail);
      setMessage("Harness session launched.");
      await refreshSessionSurface(selectedWorkspace.slug, nextId);
    } finally {
      setSessionBusy("");
    }
  }

  async function cancelSession() {
    if (!sessionDetail) {
      return;
    }
    setSessionBusy("cancel");
    try {
      const response = await api<{ detail: HarnessSessionDetail }>(`/api/sessions/${encodeURIComponent(sessionDetail.session.id)}/cancel`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setSessionDetail(response.detail);
      setMessage("Harness session canceled.");
      await refreshSessionSurface(selectedSlug, response.detail.session.id);
    } finally {
      setSessionBusy("");
    }
  }

  async function revertSession() {
    if (!sessionDetail) {
      return;
    }
    setSessionBusy("refresh");
    try {
      const response = await api<{ detail: HarnessSessionDetail }>(`/api/sessions/${encodeURIComponent(sessionDetail.session.id)}/revert`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setSessionDetail(response.detail);
      setMessage("Harness session reverted.");
      await refreshSessionSurface(selectedSlug, response.detail.session.id);
    } finally {
      setSessionBusy("");
    }
  }

  async function sendTerminalInput() {
    if (!sessionDetail || !terminalInput.trim()) {
      return;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/sessions/${encodeURIComponent(sessionDetail.session.id)}/pty`);
    await new Promise<void>((resolvePromise, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Terminal attach timed out.")), 5000);
      socket.onopen = () => {
        window.clearTimeout(timer);
        socket.send(`${terminalInput}\n`);
        window.setTimeout(() => {
          socket.close();
          resolvePromise();
        }, 300);
      };
      socket.onerror = () => reject(new Error("Terminal attach failed."));
    });
    setTerminalInput("");
    await readSession(sessionDetail.session.id);
  }

  async function saveWikiPage() {
    if (!selectedPage) {
      return;
    }
    const response = await api<{ page: WikiPage }>(`/api/wiki/${scopePath(memoryScope)}/${encodePathSegments(selectedPage)}`, {
      method: "PUT",
      body: JSON.stringify({ body: wikiBody, author: "user", summary: `wiki: edit ${memoryScope}/${selectedPage}` })
    });
    setWikiPage(response.page);
    setMessage("Wiki page saved.");
    await refreshMemory(memoryScope, response.page.page);
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = String(form.get("q") ?? "").trim();
    if (!query) {
      setSearchHits([]);
      return;
    }
    const params = new URLSearchParams({ q: query, scope: memoryScope });
    const response = await api<{ hits: SearchHit[] }>(`/api/search?${params.toString()}`);
    setSearchHits(response.hits);
  }

  async function warmNow() {
    await api("/api/warm", { method: "POST", body: JSON.stringify({}) });
    const response = await api<{ overview: Overview }>("/api/overview");
    setOverview(response.overview);
    setMessage("Warm cache refreshed.");
  }

  function openCommandPanel(view: CommandView) {
    setActiveView(view);
    setRightPanelOpen(true);
    setSessionsOpen(false);
    setCommandMenuOpen(false);
  }

  function pulseOrb() {
    setOrbPulse((value) => value + 1);
  }

  async function submitOrbChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = chatText.trim();
    if (!text) {
      return;
    }
    const timestamp = new Date().toISOString();
    pulseOrb();
    setOrbBusy(true);
    setOrbTurns((turns) => [...turns, {
      id: `user_${timestamp}_${turns.length}`,
      role: "user",
      text,
      timestamp
    }]);
    setChatText("");
    try {
      const response = await api<OrbChatResponse>("/api/orb/chat", {
        method: "POST",
        body: JSON.stringify({ message: text })
      });
      pulseOrb();
      setOrbTurns((turns) => [...turns, {
        id: `ward_${response.trace_id}`,
        role: "ward",
        text: response.reply,
        timestamp: response.timestamp
      }]);
      if (response.surface === "sessions") {
        setActiveView("sessions");
        setSessionsOpen(true);
        setRightPanelOpen(false);
      } else {
        setActiveView(response.surface);
        setRightPanelOpen(true);
        setSessionsOpen(false);
      }
    } finally {
      setOrbBusy(false);
    }
  }

  const planRounds: PlanRoundName[] = ["context", "proposal", "critique", "convergence", "decision"];
  const latestRound = planDetail?.rounds[planDetail.rounds.length - 1] ?? null;
  const latestSnapshot = repoSnapshots[0] ?? null;
  const planIsDraft = planDetail?.packet?.status === "draft";
  const planIsApproved = planDetail?.packet?.status === "approved";
  const commandTabs: Array<{ id: CommandView; label: string; meta: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "overview", label: "Overview", meta: overview?.brief.local_date ?? "warm", icon: LayoutDashboard },
    { id: "workspaces", label: "Workspaces", meta: String(workspaces.length), icon: Boxes },
    { id: "planning", label: "Planning", meta: String(plans.length), icon: Waypoints },
    { id: "sessions", label: "Sessions", meta: String(sessions.length), icon: BrainCircuit },
    { id: "memory", label: "Memory", meta: String(wikiPages.length), icon: Database },
    { id: "settings", label: "Settings", meta: profile?.display_name ?? "profile", icon: Settings }
  ];
  const activeCommand = commandTabs.find((tab) => tab.id === activeView) ?? commandTabs[0];
  const latestOrbReply = [...orbTurns].reverse().find((turn) => turn.role === "ward")?.text;

  return (
    <main className="orb-shell">
      <div className="orb-background" aria-hidden="true" />
      <header className="orb-topbar">
        <Button className="orb-icon-button" size="icon" type="button" variant="secondary" onClick={() => {
          if (activeView === "sessions" && sessionsOpen) {
            setSessionsOpen(false);
            return;
          }
          setActiveView("sessions");
          setSessionsOpen(true);
          setRightPanelOpen(false);
          setCommandMenuOpen(false);
        }} aria-label="Toggle sessions">
          {sessionsOpen ? <X className="size-4" /> : <Menu className="size-4" />}
        </Button>
        <div className="orb-brand">
          <p><Sparkles className="size-3.5" /> WARD</p>
        </div>
        <div className="orb-menu-wrap">
          <Button className="orb-icon-button" size="icon" type="button" variant="secondary" onClick={() => setCommandMenuOpen((value) => !value)} aria-label="Open command menu">
            <Settings className="size-4" />
          </Button>
          {commandMenuOpen ? (
            <div className="command-menu">
              {commandTabs.filter((tab) => tab.id !== "sessions").map((tab) => {
                const Icon = tab.icon;
                return (
                  <button key={tab.id} type="button" onClick={() => openCommandPanel(tab.id)}>
                    <Icon className="size-4" />
                    <span>{tab.label}</span>
                    <small>{tab.meta}</small>
                  </button>
                );
              })}
              <button type="button" onClick={() => refresh().then(() => Promise.all([refreshPlanSurface(), refreshSessionSurface()])).catch((err) => setError(err.message))}>
                <RefreshCw className="size-4" />
                <span>Refresh</span>
                <small>sync</small>
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {error && <p className="banner error">{error}</p>}
      {message && <p className="banner">{message}</p>}

      <section className="orb-stage">
        <div className="orb-title">
          <h5>WARD</h5>
          <p>{overview?.brief.narration ?? "WARD is preparing your brief."}</p>
        </div>
        <WardOrb pulseKey={orbPulse} />
        <form className="orb-dock" onSubmit={(event) => submitOrbChat(event).catch((err) => setError(err.message))}>
          <Button className="speak-cta" type="button" onClick={() => {
            pulseOrb();
            overview && speak(latestOrbReply ?? overview.brief.narration, overview.profile);
          }}>
            <Mic className="size-5" />
            Speak
          </Button>
          <input value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder="Ask WARD..." disabled={orbBusy} />
          <Button size="icon" type="submit" aria-label="Send to WARD" disabled={orbBusy}>
            <Send className="size-4" />
          </Button>
        </form>
        {orbTurns.length ? (
          <div className="orb-transcript">
            {orbTurns.slice(-4).map((turn) => (
              <div className={turn.role === "ward" ? "ward" : "user"} key={turn.id}>
                <span>{turn.role === "ward" ? "WARD" : "You"}</span>
                <p>{turn.text}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {rightPanelOpen || sessionsOpen ? (
        <aside className={`surface-drawer ${activeView === "sessions" ? "left" : "right"}`}>
          <div className="drawer-title">
            <div>
              <span>{activeView === "sessions" ? "Live runs" : activeCommand.meta}</span>
              <h2>{activeCommand.label}</h2>
            </div>
            <Button size="icon" type="button" variant="ghost" onClick={() => {
              if (activeView === "sessions") {
                setSessionsOpen(false);
              } else {
                setRightPanelOpen(false);
              }
            }} aria-label="Close panel">
              <X className="size-4" />
            </Button>
          </div>

      {activeView === "overview" ? <section className="overview-grid">
        <section className="panel brief-panel">
          <div className="panel-title">
            <h2>{overview?.brief.greeting ?? "Overview"}</h2>
            <span>{overview?.brief.local_date ?? "warming"}</span>
          </div>
          <p className="brief-copy">{overview?.brief.narration ?? "WARD is preparing your brief."}</p>
          <div className="metrics">
            <div>
              <strong>{overview?.brief.counts.active_workspaces ?? 0}</strong>
              <span>workspaces</span>
            </div>
            <div>
              <strong>{overview?.brief.counts.open_tasks ?? 0}</strong>
              <span>open tasks</span>
            </div>
            <div>
              <strong>{overview?.brief.counts.blockers ?? 0}</strong>
              <span>blockers</span>
            </div>
            <div>
              <strong>{overview?.recent_handoffs.length ?? 0}</strong>
              <span>handoffs</span>
            </div>
          </div>
          <div className="actions">
            <button type="button" disabled={!overview} onClick={() => overview && speak(overview.brief.narration, overview.profile)}>
              Speak
            </button>
            <button type="button" disabled={!overview} onClick={() => overview && speak("WARD notification test.", overview.profile)}>
              Test
            </button>
            <button type="button" onClick={() => warmNow().catch((err) => setError(err.message))}>
              Warm
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>Next</h2>
            <span>{overview?.brief.next_actions.length ?? 0}</span>
          </div>
          <div className="list compact">
            {overview?.brief.next_actions.map((action) => (
              <div className="item static" key={`${action.workspace_slug}-${action.task_id}-${action.title}`}>
                <strong>{action.title}</strong>
                <span>{action.workspace_slug ?? "global"} · {action.action}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>Handoffs</h2>
            <span>{overview?.cache.hit_rate ? `${Math.round(overview.cache.hit_rate * 100)}% hot` : "ready"}</span>
          </div>
          <div className="list compact">
            {overview?.recent_handoffs.map((handoff) => (
              <div className="item static" key={handoff.id}>
                <strong>{handoff.status}</strong>
                <span>{handoff.handoff}</span>
              </div>
            ))}
          </div>
        </section>
      </section> : null}

      {activeView === "settings" ? <section className="settings-grid">
        <form className="panel profile-panel" key={profile ? `${profile.display_name}-${profile.tts_voice ?? ""}-${voices.length}` : "profile-loading"} onSubmit={saveProfile}>
          <div className="panel-title">
            <h2>Profile</h2>
            <span>{profile?.display_name ? "ready" : "first run"}</span>
          </div>
          <label>
            Name
            <input name="display_name" defaultValue={profile?.display_name ?? ""} required />
          </label>
          <label>
            Timezone
            <input name="timezone" defaultValue={profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} />
          </label>
          <div className="row">
            <label>
              Tone
              <select name="persona_tone" defaultValue={profile?.persona_tone ?? "casual"}>
                <option value="casual">Casual</option>
                <option value="formal">Formal</option>
              </select>
            </label>
            <label>
              Presence
              <select name="presence_default" defaultValue={profile?.presence_default ?? "present"}>
                <option value="present">Present</option>
                <option value="away">Away</option>
                <option value="dnd">DND</option>
              </select>
            </label>
          </div>
          <label className="check-row">
            <input name="tts_enabled" type="checkbox" defaultChecked={profile?.tts_enabled ?? false} />
            TTS
          </label>
          <div className="tts-grid">
            <label>
              Voice
              <select name="tts_voice" defaultValue={profile?.tts_voice ?? ""}>
                <option value="">System best</option>
                {voices.map((voice) => (
                  <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                    {voice.name} · {voice.lang}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rate
              <input name="tts_rate" type="number" min="0.6" max="1.4" step="0.05" defaultValue={profile?.tts_rate ?? 1} />
            </label>
            <label>
              Pitch
              <input name="tts_pitch" type="number" min="0.7" max="1.3" step="0.05" defaultValue={profile?.tts_pitch ?? 1} />
            </label>
          </div>
          <button type="submit">Save</button>
        </form>

        <section className="panel brains-panel">
          <div className="panel-title">
            <h2>Brains</h2>
            <span>{enabledBrains.length}/{brainRegistry.brains.length} enabled</span>
          </div>
          <div className="brain-dashboard">
            {brainRegistry.brains.map((brain) => {
              const cost = costByBrain.get(brain.id);
              const forecast = forecastByBrain.get(brain.id);
              return (
                <div className={brain.enabled ? "brain-control active" : "brain-control"} key={brain.id}>
                  <div className="brain-control-head">
                    <div>
                      <strong>{brainDisplayName(brain)}</strong>
                      <span>{brain.id}</span>
                    </div>
                    <Badge tone={brain.enabled ? "success" : "default"}>{brain.enabled ? "enabled" : "off"}</Badge>
                  </div>
                  <div className="brain-facts">
                    <span>{runtimeLabel(brain.runtime)}</span>
                    <span>{authLabel(brain.auth)}</span>
                    <span>{accountingLabel(brain.accounting)}</span>
                    <span>{brain.concurrency_cap} cap</span>
                  </div>
                  <div className="brain-tags">
                    {(brain.tags.length ? brain.tags : [brain.source]).slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                  <div className="brain-cost-line">
                    <span>{cost?.invocations ?? 0} calls</span>
                    <span>{formatDuration(cost?.duration_ms ?? 0)}</span>
                    <span>{formatDollars(cost?.dollars_estimate ?? 0)}</span>
                    <span>{forecast ? `${forecast.status} ${formatMetric(forecast.current, forecast.metric)}` : "forecast pending"}</span>
                  </div>
                  <button
                    type="button"
                    disabled={brainBusy === `brain:${brain.id}`}
                    onClick={() => toggleBrain(brain.id, !brain.enabled).catch((err) => setError(err.message))}
                  >
                    {brainBusy === `brain:${brain.id}` ? "Saving..." : brain.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel routes-panel">
          <div className="panel-title">
            <h2>Routing</h2>
            <span>{brainRegistry.routing.length}</span>
          </div>
          <div className="route-list">
            {brainRegistry.routing.map((route) => (
              <form className="route-row" key={`${route.concern}-${route.updated_at}`} onSubmit={(event) => saveBrainRoute(event, route.concern).catch((err) => setError(err.message))}>
                <div>
                  <strong>{titleCase(route.concern)}</strong>
                  <span>{route.brain_ids.map((brainId) => brainDisplayName(brainById.get(brainId), brainId)).join(" + ")}</span>
                </div>
                <select name="brain_ids" multiple defaultValue={route.brain_ids} size={Math.min(4, Math.max(2, brainRegistry.brains.length))}>
                  {brainRegistry.brains.map((brain) => (
                    <option key={brain.id} value={brain.id}>
                      {brainDisplayName(brain)} · {runtimeLabel(brain.runtime)}
                    </option>
                  ))}
                </select>
                <button type="submit" disabled={brainBusy === `route:${route.concern}`}>
                  {brainBusy === `route:${route.concern}` ? "Saving..." : "Save"}
                </button>
              </form>
            ))}
          </div>
        </section>

        <section className="panel cost-panel">
          <div className="panel-title">
            <h2>Cost Today</h2>
            <span>{costSummary?.date ?? "today"}</span>
          </div>
          <div className="cost-metrics">
            <div>
              <strong>{costSummary?.totals.invocations ?? 0}</strong>
              <span>calls</span>
            </div>
            <div>
              <strong>{formatDuration(costSummary?.totals.duration_ms ?? 0)}</strong>
              <span>duration</span>
            </div>
            <div>
              <strong>{(costSummary?.totals.tokens_in ?? 0) + (costSummary?.totals.tokens_out ?? 0)}</strong>
              <span>tokens</span>
            </div>
            <div>
              <strong>{formatDollars(costSummary?.totals.dollars_estimate ?? 0)}</strong>
              <span>estimate</span>
            </div>
          </div>
          <div className="cost-list">
            {(costSummary?.by_brain ?? []).map((row) => (
              <div className="cost-row" key={`${row.brain_id}-${row.accounting_mode}`}>
                <strong>{brainDisplayName(brainById.get(row.brain_id), row.brain_id)}</strong>
                <span>{row.invocations} calls · {formatDuration(row.duration_ms)} · {formatDollars(row.dollars_estimate)}</span>
              </div>
            ))}
            {costSummary && costSummary.by_brain.length === 0 ? <p className="empty-copy">No brain calls recorded today.</p> : null}
          </div>
        </section>

        <section className="panel quota-panel">
          <div className="panel-title">
            <h2>Quota Ledger</h2>
            <span>{quotaLedger.length}</span>
          </div>
          <div className="quota-list">
            {quotaLedger.map((entry) => (
              <div className="quota-row" key={entry.id}>
                <strong>{entry.policy_id}</strong>
                <span>{entry.target} · {entry.metric} · {formatMetric(entry.amount, entry.metric)}</span>
              </div>
            ))}
            {quotaLedger.length === 0 ? <p className="empty-copy">Quota events will appear after brain calls.</p> : null}
          </div>
        </section>
      </section> : null}

      {activeView === "workspaces" ? <section className="workspace-grid">
        <section className="panel">
          <div className="panel-title">
            <h2>Workspaces</h2>
            <span>{workspaces.length}</span>
          </div>
          <form className="stack" onSubmit={createWorkspace}>
            <input name="name" placeholder="Workspace name" required />
            <input name="description" placeholder="Description" />
            <input name="repo" placeholder="/path/to/repo" />
            <button type="submit">Create</button>
          </form>
          <div className="list">
            {workspaces.map((workspace) => (
              <button
                className={workspace.slug === selectedSlug ? "item active" : "item"}
                key={workspace.id}
                type="button"
                onClick={() => setSelectedSlug(workspace.slug)}
              >
                <strong>{workspace.name}</strong>
                <span>{workspace.slug} · {workspace.autonomy_level}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>Tasks</h2>
            <span>{detail?.tasks.length ?? tasks.length}</span>
          </div>
          <form className="task-form" onSubmit={createTask}>
            <input name="title" placeholder="Task title" required disabled={!selectedWorkspace} />
            <select name="type" disabled={!selectedWorkspace}>
              <option value="feature">Feature</option>
              <option value="bug">Bug</option>
              <option value="chore">Chore</option>
              <option value="research">Research</option>
            </select>
            <select name="priority" disabled={!selectedWorkspace}>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
              <option value="low">Low</option>
            </select>
            <button type="submit" disabled={!selectedWorkspace}>Add</button>
          </form>
          <div className="table">
            {(detail?.tasks ?? tasks).map((task) => (
              <div className="table-row" key={task.id}>
                <strong>{task.title}</strong>
                <span>{task.status}</span>
                <span>{task.lifecycle_phase}</span>
                <span>{task.priority}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>Attachments</h2>
            <span>{detail?.attachments.length ?? 0}</span>
          </div>
          <form className="stack" onSubmit={uploadAttachment}>
            <input name="file" type="file" accept=".md,.markdown,.txt,.text,.pdf,text/plain,text/markdown,application/pdf" disabled={!selectedWorkspace} required />
            <button type="submit" disabled={!selectedWorkspace}>Attach</button>
          </form>
          <div className="list compact">
            {detail?.attachments.map((attachment) => (
              <div className="item static" key={attachment.id}>
                <strong>{attachment.name}</strong>
                <span>{attachment.kind} · {attachment.bytes} bytes</span>
              </div>
            ))}
          </div>
        </section>
      </section> : null}

      {activeView === "planning" ? <section className="plan-grid">
        <section className="panel plan-sidebar">
          <div className="panel-title">
            <h2>Plan Mode</h2>
            <span>{plans.length}</span>
          </div>
          <form className="stack" onSubmit={(event) => startPlan(event).catch((err) => setError(err.message))}>
            <input name="prompt" placeholder="Plan prompt" disabled={!selectedWorkspace} />
            <div className="plan-controls">
              <select name="policy" defaultValue="consensus" disabled={!selectedWorkspace}>
                <option value="consensus">Consensus</option>
                <option value="coordinator_decides">Coordinator decides</option>
                <option value="user_decides">User decides</option>
              </select>
              <label className="check-row small-check">
                <input name="clarify" type="checkbox" disabled={!selectedWorkspace} />
                Clarify
              </label>
            </div>
            <div className="start-actions">
              <button type="submit" disabled={!selectedWorkspace || planBusy !== ""}>
                {planBusy === "start" ? "Starting..." : "Start"}
              </button>
              <button type="button" disabled={!selectedWorkspace || plans.length === 0 || planBusy !== ""} onClick={() => clearPlans().catch((err) => setError(err.message))}>
                {planBusy === "clear" ? "Clearing..." : "Clear Plans"}
              </button>
            </div>
          </form>
          <div className="list compact">
            {plans.map((plan) => {
              const planId = plan.packet?.packet_id ?? plan.session.id;
              return (
                <button
                  className={planId === selectedPlanId ? "item active" : "item"}
                  key={plan.session.id}
                  type="button"
                  onClick={() => readPlan(planId).catch((err) => setError(err.message))}
                >
                  <strong>{plan.packet?.title ?? plan.session.prompt}</strong>
                  <span>{plan.packet?.status ?? plan.session.status} · {plan.session.current_round}</span>
                </button>
              );
            })}
          </div>
          <div className="snapshot-card">
            <div className="panel-title">
              <h2>Code Context</h2>
              <span>{repoSnapshots.length}</span>
            </div>
            <button type="button" disabled={!selectedWorkspace || planBusy !== ""} onClick={() => refreshCodeContext().catch((err) => setError(err.message))}>
              {planBusy === "refresh-context" ? "Refreshing..." : "Refresh"}
            </button>
            {latestSnapshot && (
              <div className="snapshot-meta">
                <strong>{latestSnapshot.branch ?? "unknown branch"}</strong>
                <span>{latestSnapshot.head_commit?.slice(0, 12) ?? "no head"} · {latestSnapshot.key_files.length} key files</span>
                <small>{latestSnapshot.key_files.slice(0, 6).join(", ") || latestSnapshot.local_path}</small>
              </div>
            )}
          </div>
        </section>

        <section className="panel plan-review">
          <div className="panel-title">
            <h2>{planDetail?.packet?.title ?? "Decision Review"}</h2>
            <span>{planDetail?.packet?.status ?? planDetail?.session.status ?? "idle"}</span>
          </div>
          <div className="round-rail">
            {planRounds.map((round) => {
              const completed = Boolean(planDetail?.rounds.some((item) => item.round_name === round));
              const active = planDetail?.session.current_round === round;
              return <span className={`${completed ? "done" : ""} ${active ? "active" : ""}`} key={round}>{round}</span>;
            })}
          </div>
          {latestRound ? (
            <div className="moderator">
              <strong>{latestRound.round_name}</strong>
              <p>{latestRound.moderator_summary}</p>
            </div>
          ) : (
            <div className="moderator muted">
              <strong>No active packet</strong>
              <p>{selectedWorkspace ? "Start a plan for this workspace." : "Select a workspace first."}</p>
            </div>
          )}
          {planDetail?.session.clarifying_questions.length ? (
            <form className="answer-form" onSubmit={(event) => answerPlan(event).catch((err) => setError(err.message))}>
              <div className="question-stack">
                {planDetail.session.clarifying_questions.map((question) => <strong key={question}>{question}</strong>)}
              </div>
              <input name="answer" placeholder="Answer" required disabled={planBusy !== ""} />
              <button type="submit" disabled={planBusy !== ""}>
                {planBusy === "answer" ? "Answering..." : "Answer"}
              </button>
            </form>
          ) : null}
          {planDetail?.packet && (
            <div className="packet">
              <p>{planDetail.packet.summary}</p>
              <div className="packet-columns">
                <div>
                  <h3>Goals</h3>
                  <ul>{planDetail.packet.goals.map((goal) => <li key={goal}>{goal}</li>)}</ul>
                </div>
                <div>
                  <h3>Risks</h3>
                  <ul>{planDetail.packet.risks.map((risk) => <li key={risk.risk}>{risk.risk}</li>)}</ul>
                </div>
              </div>
              <div className="task-chips">
                {planDetail.packet.tasks.map((task) => (
                  <span key={task.title}>{task.title}</span>
                ))}
              </div>
              <div className="source-line">
                <span>{planDetail.packet.source.participants.length} participants</span>
                <span>{planDetail.packet.source.round_transcripts.length} transcripts</span>
                <span>{planDetail.packet.source.attachments_considered.length} attachments</span>
              </div>
            </div>
          )}
          <div className="plan-actions">
            <button type="button" disabled={!planIsDraft || planBusy !== ""} onClick={() => approvePlanPacket().catch((err) => setError(err.message))}>
              {planBusy === "approve" ? "Approving..." : "Approve"}
            </button>
            <button type="button" disabled={!planIsApproved || planBusy !== ""} onClick={() => generatePlanTasks().catch((err) => setError(err.message))}>
              {planBusy === "generate" ? "Generating..." : "Generate Tasks"}
            </button>
            <button type="button" disabled={!activePlanRef() || planBusy !== ""} onClick={() => readPlan(activePlanRef()).catch((err) => setError(err.message))}>
              Reload
            </button>
          </div>
          <form className="revision-form" onSubmit={(event) => revisePlanPacket(event).catch((err) => setError(err.message))}>
            <input name="notes" placeholder="Revision notes" disabled={!planDetail?.packet || planBusy !== ""} />
            <button type="submit" disabled={!planDetail?.packet || planBusy !== ""}>
              {planBusy === "revise" ? "Revising..." : "Revise"}
            </button>
          </form>
        </section>

        <section className="panel plan-participants">
          <div className="panel-title">
            <h2>Participants</h2>
            <span>{latestRound?.participants_json.length ?? 0}</span>
          </div>
          <div className="list compact">
            {latestRound?.participants_json.map((output) => (
              <div className="item static" key={`${latestRound.id}-${output.participant_id}`}>
                <strong>{output.participant_id}</strong>
                <span>{participantMeta(output)}</span>
                <small>{participantSummary(output)}</small>
              </div>
            ))}
          </div>
        </section>
      </section> : null}

      {activeView === "sessions" ? <section className="session-grid">
        <section className="panel session-sidebar">
          <div className="panel-title">
            <h2>Sessions</h2>
            <span>{sessions.length}</span>
          </div>
          <form className="stack" onSubmit={(event) => launchSession(event).catch((err) => setError(err.message))}>
            <input name="goal" placeholder="Session goal" disabled={!selectedWorkspace} />
            <select name="task_id" disabled={!selectedWorkspace}>
              <option value="">No task</option>
              {detail?.tasks.map((task) => (
                <option key={task.id} value={task.id}>{task.title}</option>
              ))}
            </select>
            <select name="brain_id" defaultValue="stub-worker" disabled={!selectedWorkspace || enabledBrains.length === 0}>
              {enabledBrains.length === 0 ? <option value="">No brains enabled</option> : null}
              {enabledBrains.map((brain) => (
                <option key={brain.id} value={brain.id}>
                  {brainDisplayName(brain)} · {runtimeLabel(brain.runtime)} · {accountingLabel(brain.accounting)}
                </option>
              ))}
            </select>
            <div className="session-controls">
              <select name="mode" defaultValue="headless" disabled={!selectedWorkspace}>
                <option value="headless">Headless</option>
                <option value="visible">Visible</option>
              </select>
              <select name="scenario" defaultValue="default" disabled={!selectedWorkspace}>
                <option value="default">Normal run</option>
                <option value="fails">Stub failure</option>
                <option value="await-approval">Approval wait</option>
                <option value="tool-denied">Tool denied</option>
                <option value="idle-timeout">Idle watchdog</option>
                <option value="visible-echo">Visible echo</option>
                <option value="qa-missing-evidence">QA missing evidence</option>
                <option value="file-write">File write</option>
                <option value="throughput">Throughput</option>
                <option value="long-running">Long running</option>
              </select>
            </div>
            <button type="submit" disabled={!selectedWorkspace || enabledBrains.length === 0 || sessionBusy !== ""}>
              {sessionBusy === "launch" ? "Launching..." : "Launch Session"}
            </button>
          </form>
          <div className="brain-registry">
            {enabledBrains.map((brain) => (
              <div className="brain-card" key={brain.id}>
                <strong>{brainDisplayName(brain)}</strong>
                <span>{brainSummary(brain)}</span>
              </div>
            ))}
          </div>
          <div className="list compact">
            {sessions.map((session) => (
              <button
                className={session.id === selectedSessionId ? "item session-card active" : "item session-card"}
                key={session.id}
                type="button"
                onClick={() => readSession(session.id).catch((err) => setError(err.message))}
              >
                <div className="session-row">
                  <strong>{session.task_title ?? session.brain_id ?? session.id}</strong>
                  <Badge tone={stateBadgeTone(session.lifecycle_state)}>{stateLabel(session.lifecycle_state)}</Badge>
                </div>
                <span>{session.brain_id ?? "brain pending"} · {runtimeLabel(session.runtime_kind)} · {session.mode ?? "headless"}</span>
                <small>{session.queue_state ?? "queue"}{session.queue_position ? ` #${session.queue_position}` : ""}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="panel session-detail">
          <div className="panel-title">
            <h2>{sessionDetail?.session.task_title ?? "Session Detail"}</h2>
            <Badge tone={stateBadgeTone(sessionDetail?.session.lifecycle_state)}>{stateLabel(sessionDetail?.session.lifecycle_state)}</Badge>
          </div>
          <div className="session-metrics">
            <div>
              <strong>{sessionDetail?.events.length ?? 0}</strong>
              <span>events</span>
            </div>
            <div>
              <strong>{sessionDetail?.artifacts.length ?? 0}</strong>
              <span>artifacts</span>
            </div>
            <div>
              <strong>{sessionDetail?.session.worker_pid ?? "-"}</strong>
              <span>worker</span>
            </div>
            <div>
              <strong>{sessionDetail?.session.mode ?? "-"}</strong>
              <span>mode</span>
            </div>
          </div>
          <div className="session-status-strip">
            <div>
              <span>Brain</span>
              <strong>{brainDisplayName(selectedSessionBrain, selectedSession?.brain_id)}</strong>
              <small>{brainSummary(selectedSessionBrain, selectedSession?.brain_id)}</small>
            </div>
            <div>
              <span>Runtime</span>
              <strong>{runtimeLabel(selectedSession?.runtime_kind)}</strong>
              <small>{selectedSession?.scenario ? titleCase(selectedSession.scenario) : "No scenario"}</small>
            </div>
            <div>
              <span>Queue</span>
              <strong>{selectedSession?.queue_state ?? "idle"}</strong>
              <small>{selectedSession?.queue_position ? `position ${selectedSession.queue_position}` : "no wait"}</small>
            </div>
          </div>
          {latestSessionIssue ? (
            <div className={`session-banner ${stateTone(sessionDetail?.session.lifecycle_state)}`}>
              <strong>{sessionDetail?.session.lifecycle_state === "blocked" ? "Blocked, not broken" : "Latest issue"}</strong>
              <p>{eventSummary(latestSessionIssue)}</p>
            </div>
          ) : null}
          <div className="moderator">
            <strong>{sessionDetail ? sessionDetail.session.summary ?? brainDisplayName(selectedSessionBrain, selectedSession?.brain_id) : "No active session"}</strong>
            <p>{sessionDetail?.session.working_dir ?? (selectedWorkspace ? "Launch a session for this workspace." : "Select a workspace first.")}</p>
          </div>
          {latestAssistantMessage ? (
            <div className="moderator latest-message">
              <strong>Latest Message</strong>
              <p>{eventSummary(latestAssistantMessage)}</p>
            </div>
          ) : null}
          {sessionDetail?.session.mode === "visible" ? (
            <div className="terminal-pane">
              <pre>{sessionDetail.pty_output || "Terminal output will appear here."}</pre>
              <div className="session-controls">
                <input value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} placeholder="Type terminal input" />
                <button type="button" onClick={() => sendTerminalInput().catch((err) => setError(err.message))}>Send</button>
              </div>
            </div>
          ) : null}
          <div className="session-actions">
            <button type="button" disabled={!sessionDetail || sessionBusy !== ""} onClick={() => refreshSessionSurface(selectedSlug, selectedSessionId).catch((err) => setError(err.message))}>
              {sessionBusy === "refresh" ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" disabled={!sessionDetail || ["done", "failed", "blocked", "canceled"].includes(sessionDetail.session.lifecycle_state ?? "") || sessionBusy !== ""} onClick={() => cancelSession().catch((err) => setError(err.message))}>
              {sessionBusy === "cancel" ? "Canceling..." : "Cancel"}
            </button>
            <button type="button" disabled={!sessionDetail || sessionBusy !== ""} onClick={() => revertSession().catch((err) => setError(err.message))}>
              Revert
            </button>
          </div>
        </section>

        <section className="panel session-events">
          <div className="panel-title">
            <h2>Event Log</h2>
            <span>{sessionDetail?.events.length ?? 0}</span>
          </div>
          <div className="event-log">
            {sessionDetail?.events.slice(-12).map((event) => (
              <div className="event-item" key={event.event_id}>
                <strong>{event.event_type}</strong>
                <span>{event.source} · {new Date(event.timestamp).toLocaleTimeString()}</span>
                <small>{eventSummary(event)}</small>
              </div>
            ))}
          </div>
        </section>
      </section> : null}

      {activeView === "memory" ? <section className="memory-grid">
        <section className="panel memory-tree">
          <div className="panel-title">
            <h2>Memory</h2>
            <span>{wikiPages.length}</span>
          </div>
          <select value={memoryScope} onChange={(event) => setMemoryScope(event.target.value)}>
            <option value="universal">Universal</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={`workspace/${workspace.slug}`}>
                {workspace.name}
              </option>
            ))}
          </select>
          <div className="list memory-pages">
            {wikiPages.map((page) => (
              <button
                className={page.page === selectedPage ? "item active" : "item"}
                key={page.path}
                type="button"
                onClick={() => readMemoryPage(memoryScope, page.page).catch((err) => setError(err.message))}
              >
                <strong>{page.title}</strong>
                <span>{page.page} · {page.last_author ?? "new"}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel memory-reader">
          <div className="panel-title">
            <h2>{wikiPage?.title ?? "Page"}</h2>
            <span>{wikiPage?.last_author ? `last ${wikiPage.last_author}` : "draft"}</span>
          </div>
          <textarea
            value={wikiBody}
            onChange={(event) => setWikiBody(event.target.value)}
            disabled={!selectedPage}
            spellCheck
          />
          <div className="actions">
            <button type="button" disabled={!selectedPage} onClick={() => saveWikiPage().catch((err) => setError(err.message))}>
              Save
            </button>
            <button type="button" disabled={!selectedPage} onClick={() => refreshMemory(memoryScope, selectedPage).catch((err) => setError(err.message))}>
              Reload
            </button>
          </div>
          <div className="history">
            {commits.map((commit) => (
              <div key={commit.hash}>
                <strong>{commit.subject}</strong>
                <span>{commit.hash.slice(0, 7)} · {commit.author_name}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel memory-search">
          <div className="panel-title">
            <h2>Search</h2>
            <span>{searchHits.length}</span>
          </div>
          <form className="search-form" onSubmit={search}>
            <input name="q" placeholder="Query" />
            <button type="submit">Go</button>
          </form>
          <div className="list compact">
            {searchHits.map((hit) => (
              <button
                className="item"
                key={hit.doc_id}
                type="button"
                onClick={() => {
                  if (hit.kind === "wiki" && hit.path) {
                    const page = hit.path.split("/").slice(hit.scope === "universal" ? 1 : 3).join("/");
                    setMemoryScope(hit.scope);
                    readMemoryPage(hit.scope, page).catch((err) => setError(err.message));
                  }
                }}
              >
                <strong>{hit.title}</strong>
                <span>{hit.kind} · {hit.scope}</span>
                <small>{hit.snippet}</small>
              </button>
            ))}
          </div>
        </section>
      </section> : null}
        </aside>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
