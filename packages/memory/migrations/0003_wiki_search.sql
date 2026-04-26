CREATE TABLE IF NOT EXISTS search_document (
  doc_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  workspace_id INTEGER REFERENCES workspace(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  path TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_document_scope ON search_document(scope, kind);

CREATE VIRTUAL TABLE IF NOT EXISTS search_document_fts USING fts5(
  doc_id UNINDEXED,
  kind UNINDEXED,
  scope UNINDEXED,
  workspace_id UNINDEXED,
  title,
  body,
  path UNINDEXED,
  updated_at UNINDEXED,
  tokenize = 'porter unicode61'
);
