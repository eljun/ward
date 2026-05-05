CREATE TABLE IF NOT EXISTS mcp_server_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  workspace_id INTEGER REFERENCES workspace(id) ON DELETE CASCADE,
  workspace_slug TEXT,
  scope TEXT NOT NULL,
  origin_path TEXT NOT NULL,
  transport TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  tool_count INTEGER NOT NULL DEFAULT 0,
  tools_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  stderr_log_path TEXT,
  checked_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  trace_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_server_status_latest
  ON mcp_server_status(server_id, workspace_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_server_status_workspace
  ON mcp_server_status(workspace_id, checked_at DESC);
