CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT PRIMARY KEY NOT NULL,
  day_key TEXT NOT NULL,
  daily_count INTEGER NOT NULL DEFAULT 0,
  month_key TEXT NOT NULL,
  monthly_count INTEGER NOT NULL DEFAULT 0,
  minute_window_start INTEGER,
  minute_count INTEGER NOT NULL DEFAULT 0,
  last_request_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_updated_at
ON ai_usage(updated_at);
