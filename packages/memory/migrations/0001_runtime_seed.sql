CREATE TABLE IF NOT EXISTS runtime_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO runtime_metadata (key, value)
VALUES ('runtime_schema', 'seed')
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
