CREATE TABLE IF NOT EXISTS brain_registry (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  runtime TEXT NOT NULL,
  auth TEXT NOT NULL,
  model TEXT,
  base_url TEXT,
  secret_ref TEXT,
  env_json TEXT NOT NULL DEFAULT '{}',
  tags_json TEXT NOT NULL DEFAULT '[]',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  concurrency_cap INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  accounting TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brain_route (
  concern TEXT PRIMARY KEY,
  brain_ids_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cost_ledger_entry (
  id TEXT PRIMARY KEY,
  brain_id TEXT NOT NULL,
  accounting_mode TEXT NOT NULL,
  trigger TEXT NOT NULL,
  workspace_id INTEGER REFERENCES workspace(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
  trace_id TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  dollars_estimate REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  invocations INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cost_ledger_brain_created
  ON cost_ledger_entry(brain_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cost_ledger_created
  ON cost_ledger_entry(created_at DESC);

CREATE TABLE IF NOT EXISTS quota_ledger (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  target TEXT NOT NULL,
  metric TEXT NOT NULL,
  window TEXT NOT NULL,
  window_start TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  trace_id TEXT NOT NULL,
  workspace_id INTEGER REFERENCES workspace(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quota_ledger_policy_window
  ON quota_ledger(policy_id, window_start, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quota_ledger_target_metric
  ON quota_ledger(scope, target, metric, created_at DESC);
