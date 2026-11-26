CREATE TABLE IF NOT EXISTS user_entitlements (
  user_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'demo' CHECK (status IN ('demo', 'trialing', 'active', 'past_due', 'cancelled', 'expired')),
  trial_started_at INTEGER,
  trial_ends_at INTEGER,
  paid_until INTEGER,
  plan_code TEXT,
  razorpay_customer_id TEXT,
  razorpay_subscription_id TEXT UNIQUE,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_usage (
  user_id TEXT PRIMARY KEY NOT NULL,
  demo_count INTEGER NOT NULL DEFAULT 0 CHECK (demo_count >= 0 AND demo_count <= 5),
  minute_window_start INTEGER,
  minute_count INTEGER NOT NULL DEFAULT 0,
  last_request_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_methods (
  provider TEXT NOT NULL,
  provider_payment_method_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  trial_claimed_at INTEGER,
  PRIMARY KEY (provider, provider_payment_method_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_user_id ON payment_methods(user_id);

CREATE TABLE IF NOT EXISTS trial_claims (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subscription_id TEXT UNIQUE,
  provider_payment_method_id TEXT,
  started_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'trialing', 'cancelled', 'converted', 'expired', 'rejected')),
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_claims_payment_method
ON trial_claims(provider, provider_payment_method_id)
WHERE provider_payment_method_id IS NOT NULL AND status IN ('trialing', 'converted', 'expired', 'cancelled');

CREATE TABLE IF NOT EXISTS subscription_events (
  provider_event_id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_entitlements_status
ON user_entitlements(status, updated_at);
