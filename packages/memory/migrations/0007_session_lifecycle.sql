ALTER TABLE session ADD COLUMN queue_state TEXT;
ALTER TABLE session ADD COLUMN working_dir TEXT;
ALTER TABLE session ADD COLUMN incognito INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session ADD COLUMN worker_pid INTEGER;
ALTER TABLE session ADD COLUMN trace_id TEXT;
ALTER TABLE session ADD COLUMN scenario TEXT;
ALTER TABLE session ADD COLUMN updated_at TEXT;

UPDATE session
SET updated_at = COALESCE(updated_at, ended_at, started_at)
WHERE updated_at IS NULL;

CREATE TABLE IF NOT EXISTS queue_entry (
  id TEXT PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE REFERENCES session(id) ON DELETE CASCADE,
  queue_scope TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_queue_entry_workspace_status
  ON queue_entry(workspace_id, status, position, created_at);
