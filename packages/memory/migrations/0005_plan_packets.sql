CREATE TABLE IF NOT EXISTS plan_session (
  id TEXT PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  current_round TEXT NOT NULL,
  prompt TEXT NOT NULL,
  convergence_policy TEXT NOT NULL,
  clarifying_questions_json TEXT NOT NULL,
  user_answers_json TEXT NOT NULL,
  packet_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_packet (
  id TEXT PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  plan_session_id TEXT NOT NULL REFERENCES plan_session(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  packet_json TEXT NOT NULL,
  supersedes TEXT REFERENCES plan_packet(id) ON DELETE SET NULL,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_packet_workspace_status
  ON plan_packet(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS plan_round_transcript (
  id TEXT PRIMARY KEY,
  plan_session_id TEXT NOT NULL REFERENCES plan_session(id) ON DELETE CASCADE,
  plan_packet_id TEXT REFERENCES plan_packet(id) ON DELETE SET NULL,
  round_index INTEGER NOT NULL,
  round_name TEXT NOT NULL,
  moderator_summary TEXT NOT NULL,
  participants_json TEXT NOT NULL,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(plan_session_id, round_index)
);

CREATE TABLE IF NOT EXISTS repo_snapshot (
  id TEXT PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES workspace_repo(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  local_path TEXT NOT NULL,
  branch TEXT,
  head_commit TEXT,
  default_branch TEXT,
  file_tree_json TEXT NOT NULL,
  key_files_json TEXT NOT NULL,
  symbols_json TEXT NOT NULL,
  recent_commits_json TEXT NOT NULL,
  diff_summary TEXT NOT NULL,
  snapshot_path TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  UNIQUE(repo_id)
);
