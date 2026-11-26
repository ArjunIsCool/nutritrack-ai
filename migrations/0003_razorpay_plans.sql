CREATE TABLE IF NOT EXISTS razorpay_plans (
  plan_code TEXT PRIMARY KEY NOT NULL CHECK (plan_code IN ('monthly', 'annual')),
  razorpay_plan_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
