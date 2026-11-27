CREATE TABLE IF NOT EXISTS session_revocations (
  user_id TEXT PRIMARY KEY NOT NULL,
  revoked_after INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
