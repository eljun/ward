import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Profile = {
  display_name: string;
  timezone: string;
  persona_tone: string;
  presence_default: string;
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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
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

function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.slug === selectedSlug) ?? null,
    [selectedSlug, workspaces]
  );

  async function refresh() {
    setError("");
    const profileResponse = await api<{ profile: Profile }>("/api/profile");
    const workspaceResponse = await api<{ workspaces: Workspace[] }>("/api/workspaces");
    const taskResponse = await api<{ tasks: Task[] }>("/api/tasks");
    setProfile(profileResponse.profile);
    setWorkspaces(workspaceResponse.workspaces);
    setTasks(taskResponse.tasks);
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

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    refreshDetail(selectedSlug).catch((err) => setError(err.message));
  }, [selectedSlug]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await api<{ profile: Profile }>("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({
        display_name: String(form.get("display_name") ?? ""),
        timezone: String(form.get("timezone") ?? "UTC"),
        persona_tone: String(form.get("persona_tone") ?? "casual"),
        presence_default: String(form.get("presence_default") ?? "present")
      })
    });
    setProfile(response.profile);
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

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">WARD</p>
          <h1>Command Center</h1>
        </div>
        <button type="button" onClick={() => refresh().catch((err) => setError(err.message))}>
          Refresh
        </button>
      </header>

      {error && <p className="banner error">{error}</p>}
      {message && <p className="banner">{message}</p>}

      <section className="grid">
        <form className="panel" onSubmit={saveProfile}>
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
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
