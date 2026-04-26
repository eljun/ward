CREATE TABLE IF NOT EXISTS user_profile (
  id TEXT PRIMARY KEY CHECK (id = 'self'),
  display_name TEXT NOT NULL DEFAULT '',
  honorific TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  work_hours_start TEXT NOT NULL DEFAULT '09:00',
  work_hours_end TEXT NOT NULL DEFAULT '17:00',
  quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
  quiet_hours_end TEXT NOT NULL DEFAULT '07:00',
  persona_tone TEXT NOT NULL DEFAULT 'casual',
  tts_enabled INTEGER NOT NULL DEFAULT 0,
  tts_voice TEXT,
  tts_rate REAL NOT NULL DEFAULT 1,
  tts_pitch REAL NOT NULL DEFAULT 1,
  presence_default TEXT NOT NULL DEFAULT 'present',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  primary_repo_path TEXT,
  autonomy_level TEXT NOT NULL DEFAULT 'standard',
  last_opened_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_repo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  local_path TEXT NOT NULL,
  branch TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  watch_enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(workspace_id, local_path)
);

CREATE TABLE IF NOT EXISTS attachment (
  id TEXT PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_path TEXT,
  storage_path TEXT NOT NULL,
  text_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  lifecycle_phase TEXT NOT NULL,
  type TEXT NOT NULL,
  priority TEXT NOT NULL,
  source TEXT NOT NULL,
  owner TEXT NOT NULL,
  autonomy_level TEXT NOT NULL,
  task_doc_path TEXT,
  evidence_packet_path TEXT,
  assignee_kind TEXT,
  plan_packet_id TEXT,
  parent_task_id TEXT REFERENCES task(id) ON DELETE SET NULL,
  external_ref_json TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_workspace_status ON task(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_task_phase ON task(lifecycle_phase);

CREATE TABLE IF NOT EXISTS task_contract (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  constraints_json TEXT NOT NULL,
  acceptance_criteria_json TEXT NOT NULL,
  file_plan_json TEXT NOT NULL,
  reporting_format TEXT NOT NULL,
  max_iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_gate (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  gate_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_gate_open ON task_gate(task_id, status);

CREATE TABLE IF NOT EXISTS task_dependency (
  task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  blocked_by_task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(task_id, blocked_by_task_id)
);

CREATE TABLE IF NOT EXISTS task_artifact (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  artifact_kind TEXT NOT NULL,
  path TEXT,
  url TEXT,
  checksum TEXT,
  redacted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  workspace_id INTEGER REFERENCES workspace(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES task(id) ON DELETE SET NULL,
  brain_id TEXT,
  runtime_kind TEXT,
  mode TEXT,
  lifecycle_state TEXT,
  summary TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS session_event (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_event (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_event_type ON system_event(event_type, created_at);

CREATE TABLE IF NOT EXISTS preference (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  workspace_id INTEGER REFERENCES workspace(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  confidence REAL NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(scope, workspace_id, key)
);
