import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
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

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.slug === selectedSlug) ?? null,
    [selectedSlug, workspaces]
  );

  async function refresh() {
    setError("");
    const profileResponse = await api<{ profile: Profile }>("/api/profile");
    const workspaceResponse = await api<{ workspaces: Workspace[] }>("/api/workspaces");
    const taskResponse = await api<{ tasks: Task[] }>("/api/tasks");
    const overviewResponse = await api<{ overview: Overview }>("/api/overview");
    setProfile(profileResponse.profile);
    setWorkspaces(workspaceResponse.workspaces);
    setTasks(taskResponse.tasks);
    setOverview(overviewResponse.overview);
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
  }, [selectedSlug]);

  useEffect(() => {
    refreshMemory(memoryScope, "").catch((err) => setError(err.message));
  }, [memoryScope]);

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

  const planRounds: PlanRoundName[] = ["context", "proposal", "critique", "convergence", "decision"];
  const latestRound = planDetail?.rounds[planDetail.rounds.length - 1] ?? null;
  const latestSnapshot = repoSnapshots[0] ?? null;
  const planIsDraft = planDetail?.packet?.status === "draft";
  const planIsApproved = planDetail?.packet?.status === "approved";

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">WARD</p>
          <h1>Command Center</h1>
        </div>
        <button type="button" onClick={() => refresh().then(() => refreshPlanSurface()).catch((err) => setError(err.message))}>
          Refresh
        </button>
      </header>

      {error && <p className="banner error">{error}</p>}
      {message && <p className="banner">{message}</p>}

      <section className="overview-grid">
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
      </section>

      <section className="grid">
        <form className="panel" key={profile ? `${profile.display_name}-${profile.tts_voice ?? ""}-${voices.length}` : "profile-loading"} onSubmit={saveProfile}>
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
      </section>

      <section className="grid detail-grid">
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
      </section>

      <section className="plan-grid">
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
      </section>

      <section className="memory-grid">
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
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
