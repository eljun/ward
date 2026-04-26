CREATE TABLE IF NOT EXISTS outcome_record (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES session(id) ON DELETE CASCADE,
  workspace_id INTEGER REFERENCES workspace(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES task(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  outcome_summary TEXT NOT NULL,
  key_changes_json TEXT NOT NULL,
  artifacts_json TEXT NOT NULL,
  blockers_json TEXT NOT NULL,
  handoff TEXT NOT NULL,
  wiki_commit TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outcome_record_workspace_created
  ON outcome_record(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_workspace_state
  ON session(workspace_id, lifecycle_state, started_at DESC);
