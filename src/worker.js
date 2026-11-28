import { createRemoteJWKSet, jwtVerify } from "jose";
import { validateImageAttachments } from "./imageValidation.js";
import { normalizeOpenFoodFactsProduct, normalizeRetailBarcode, normalizeUsdaFood } from "./barcode.js";

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

const MODEL_ALLOWLIST = new Set(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
const DAILY_LIMIT = 20;
const MONTHLY_LIMIT = 500;
const MINUTE_LIMIT = 6;
const MIN_REQUEST_INTERVAL_MS = 5000;
const MINUTE_WINDOW_MS = 60_000;
const DEMO_LIMIT = 5;
const RAZORPAY_API = "https://api.razorpay.com/v1";
const SUBSCRIPTION_PLANS = { monthly: { amount: 7500, period: "monthly", interval: 1, totalCount: 120, label: "NutriTrack AI Monthly" }, annual: { amount: 50000, period: "yearly", interval: 1, totalCount: 10, label: "NutriTrack AI Annual" } };

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

async function authenticate(request, projectId) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Please sign in to use AI meal analysis.");
  const { payload } = await jwtVerify(match[1], FIREBASE_JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    algorithms: ["RS256"],
  });
  if (!payload.sub || typeof payload.sub !== "string" || !Number.isFinite(Number(payload.auth_time))) throw new Error("Your sign-in session is invalid. Please sign in again.");
  return { uid: payload.sub, authTime: Number(payload.auth_time) };
}

const NUTRIENT_KEYS = [
  "energy_kcal", "protein_g", "carbohydrate_g", "total_fat_g", "saturated_fat_g",
  "trans_fat_g", "monounsaturated_fat_g", "polyunsaturated_fat_g", "cholesterol_mg",
  "fiber_g", "total_sugars_g", "added_sugars_g", "sodium_mg", "potassium_mg",
  "calcium_mg", "iron_mg", "magnesium_mg", "zinc_mg", "phosphorus_mg", "choline_mg",
  "selenium_ug", "copper_mg", "manganese_mg", "iodine_ug", "vitamin_a_ug_rae",
  "vitamin_c_mg", "vitamin_d_ug", "vitamin_e_mg", "vitamin_k_ug", "vitamin_b1_mg",
  "vitamin_b2_mg", "vitamin_b3_mg", "vitamin_b5_mg", "vitamin_b6_mg", "vitamin_b7_ug",
  "vitamin_b9_ug_dfe", "vitamin_b12_ug", "water_g", "caffeine_mg", "alcohol_g"
];

function makeMealPrompt(prompt, category, countryCode) {
  const country = String(countryCode || "IN").toUpperCase();
  const nutrientTemplate = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, null]));
  const schema = JSON.stringify(nutrientTemplate);
  return [
    "You are a careful, globally aware nutrition estimation assistant. The user selected country / food market ISO code " + country + ". Use it only to interpret local food names, common recipes, labels, and market context. Do not assume the user eats a particular cuisine.",
    "Analyze the meal described and/or shown in the attached photos. Text description: " + JSON.stringify(prompt) + ". Meal category: " + category + ".",
    "Return ONLY valid JSON with meal_name, items, totals, quality, assessment, assumptions, needs_clarification, and clarifying_question. Each item and totals must contain legacy numeric fields calories, protein, carbs, fat, fiber, sugar plus a nutrients object with exactly these keys: " + schema,
    "Estimate nutrients for the stated item portion and whole-meal total respectively. Use null when unknown or not responsibly estimable; never invent a value and never use zero to mean unknown. Units are encoded in keys: kcal for energy; g for protein/carbohydrate/fats/fibre/sugars/water; mg for cholesterol, sodium, potassium, calcium, iron, magnesium, zinc, phosphorus, copper, manganese, vitamins C/E/B1/B2/B3/B5/B6 and choline; mg for caffeine; g for alcohol; µg for selenium, iodine, vitamins A/D/K/B7/B9/B12.",
    "Use metric portions, realistic recipe estimates, and account for cooking oil where possible. Do not claim exactness or clinical precision. If portion ambiguity materially changes the estimate, set needs_clarification true and ask one concise question while still providing a provisional estimate. Do not provide diagnoses."
  ].join("\n");
}

async function getUsage(db, userId, now = Date.now()) {
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const monthKey = dayKey.slice(0, 7);
  const row = await db.prepare(
    "SELECT day_key, daily_count, month_key, monthly_count, minute_window_start, minute_count, last_request_at FROM ai_usage WHERE user_id = ?"
  ).bind(userId).first();

  const dailyUsed = row?.day_key === dayKey ? row.daily_count : 0;
  const monthlyUsed = row?.month_key === monthKey ? row.monthly_count : 0;
  return {
    daily: { used: dailyUsed, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - dailyUsed), resetsAt: new Date(Date.now() + (Date.parse(dayKey + "T00:00:00Z") + 86_400_000 - Date.now())).toISOString() },
    monthly: { used: monthlyUsed, limit: MONTHLY_LIMIT, remaining: Math.max(0, MONTHLY_LIMIT - monthlyUsed), resetsAt: new Date(Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 1)).toISOString() },
  };
}

async function getAccess(db, userId, now = Date.now()) {
  await db.prepare("INSERT OR IGNORE INTO user_entitlements (user_id, status, updated_at) VALUES (?, 'demo', ?)").bind(userId, now).run();
  const row = await db.prepare("SELECT status, trial_started_at, trial_ends_at, paid_until, plan_code, cancel_at_period_end FROM user_entitlements WHERE user_id = ?").bind(userId).first();
  let status = row?.status || "demo";
  if (status === "trialing" && Number(row.trial_ends_at || 0) <= now) status = "expired";
  if (status === "active" && row.paid_until && Number(row.paid_until) <= now) status = "expired";
  return {
    status,
    trialStartedAt: row?.trial_started_at || null,
    trialEndsAt: row?.trial_ends_at || null,
    paidUntil: row?.paid_until || null,
    planCode: row?.plan_code || null,
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
    demoLimit: DEMO_LIMIT,
  };
}

async function getDemoUsage(db, userId) {
  const row = await db.prepare("SELECT demo_count FROM demo_usage WHERE user_id = ?").bind(userId).first();
  const used = row?.demo_count || 0;
  return { used, limit: DEMO_LIMIT, remaining: Math.max(0, DEMO_LIMIT - used) };
}

async function reserveDemo(db, userId, now = Date.now()) {
  const minuteStart = now;
  const result = await db.prepare(`
    INSERT INTO demo_usage (user_id, demo_count, minute_window_start, minute_count, last_request_at, updated_at)
    VALUES (?, 1, ?, 1, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      demo_count = demo_usage.demo_count + 1,
      minute_count = CASE WHEN ? - demo_usage.minute_window_start >= 60000 THEN 1 ELSE demo_usage.minute_count + 1 END,
      minute_window_start = CASE WHEN ? - demo_usage.minute_window_start >= 60000 THEN ? ELSE demo_usage.minute_window_start END,
      last_request_at = excluded.last_request_at,
      updated_at = excluded.updated_at
    WHERE demo_usage.demo_count < ?
      AND (demo_usage.last_request_at IS NULL OR ? - demo_usage.last_request_at >= ?)
      AND (demo_usage.minute_window_start IS NULL OR ? - demo_usage.minute_window_start >= 60000 OR demo_usage.minute_count < ?)
  `).bind(userId, minuteStart, now, now, now, now, now, DEMO_LIMIT, now, MIN_REQUEST_INTERVAL_MS, now, MINUTE_LIMIT).run();
  const usage = await getDemoUsage(db, userId);
  if (result.meta?.changes > 0) return { allowed: true, usage };
  const row = await db.prepare("SELECT minute_window_start, minute_count, last_request_at FROM demo_usage WHERE user_id = ?").bind(userId).first();
  if (usage.remaining <= 0) return { allowed: false, status: 429, code: "DEMO_EXHAUSTED", error: "You've used all five demo analyses. Start a trial to continue.", usage };
  const cooldown = row?.last_request_at ? Math.max(0, MIN_REQUEST_INTERVAL_MS - (now - row.last_request_at)) : 0;
  const minuteWait = row?.minute_window_start && row.minute_count >= MINUTE_LIMIT ? Math.max(0, 60000 - (now - row.minute_window_start)) : 0;
  return { allowed: false, status: 429, code: "RATE_LIMITED", error: "Please wait before trying another demo analysis.", retryAfter: Math.max(1, Math.ceil(Math.max(cooldown, minuteWait) / 1000)), usage };
}

async function refundDemo(db, userId) {
  await db.prepare("UPDATE demo_usage SET demo_count = MAX(0, demo_count - 1), updated_at = ? WHERE user_id = ?").bind(Date.now(), userId).run();
}

async function hasPremiumAccess(db, userId, now = Date.now()) {
  const access = await getAccess(db, userId, now);
  return access.status === "trialing" && Number(access.trialEndsAt) > now
    || access.status === "active" && (!access.paidUntil || Number(access.paidUntil) > now);
}

async function refundAnalysis(db, userId, reservedAt = Date.now()) {
  const dayKey = new Date(reservedAt).toISOString().slice(0, 10);
  const monthKey = dayKey.slice(0, 7);
  // Refund quota for unsuccessful analyses, but retain request-throttling
  // counters so repeated failures cannot be used to bypass rate limits.
  await db.prepare(`
    UPDATE ai_usage
    SET
      daily_count = CASE WHEN day_key = ? AND daily_count > 0 THEN daily_count - 1 ELSE daily_count END,
      monthly_count = CASE WHEN month_key = ? AND monthly_count > 0 THEN monthly_count - 1 ELSE monthly_count END,
      updated_at = ?
    WHERE user_id = ?
  `).bind(dayKey, monthKey, Date.now(), userId).run();
}

async function reserveAnalysis(db, userId, now = Date.now()) {
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const monthKey = dayKey.slice(0, 7);
  const results = await db.batch([
    db.prepare(`
      INSERT INTO ai_usage (
        user_id, day_key, daily_count, month_key, monthly_count,
        minute_window_start, minute_count, last_request_at, updated_at
      ) VALUES (?, ?, 1, ?, 1, ?, 1, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        daily_count = CASE WHEN ai_usage.day_key = excluded.day_key THEN ai_usage.daily_count + 1 ELSE 1 END,
        day_key = excluded.day_key,
        monthly_count = CASE WHEN ai_usage.month_key = excluded.month_key THEN ai_usage.monthly_count + 1 ELSE 1 END,
        month_key = excluded.month_key,
        minute_count = CASE WHEN excluded.minute_window_start - ai_usage.minute_window_start >= 60000 THEN 1 ELSE ai_usage.minute_count + 1 END,
        minute_window_start = CASE WHEN excluded.minute_window_start - ai_usage.minute_window_start >= 60000 THEN excluded.minute_window_start ELSE ai_usage.minute_window_start END,
        last_request_at = excluded.last_request_at,
        updated_at = excluded.updated_at
      WHERE
        (CASE WHEN ai_usage.day_key = excluded.day_key THEN ai_usage.daily_count ELSE 0 END) < ?
        AND (CASE WHEN ai_usage.month_key = excluded.month_key THEN ai_usage.monthly_count ELSE 0 END) < ?
        AND (ai_usage.last_request_at IS NULL OR excluded.last_request_at - ai_usage.last_request_at >= ?)
        AND (ai_usage.minute_window_start IS NULL OR excluded.minute_window_start - ai_usage.minute_window_start >= 60000 OR ai_usage.minute_count < ?)
    `).bind(userId, dayKey, monthKey, now, now, now, DAILY_LIMIT, MONTHLY_LIMIT, MIN_REQUEST_INTERVAL_MS, MINUTE_LIMIT),
    db.prepare("SELECT day_key, daily_count, month_key, monthly_count, minute_window_start, minute_count, last_request_at FROM ai_usage WHERE user_id = ?").bind(userId),
  ]);

  const row = results[1]?.results?.[0];
  if (results[0]?.meta?.changes > 0) {
    return { allowed: true, usage: await getUsage(db, userId, now) };
  }

  const dailyUsed = row?.day_key === dayKey ? row.daily_count : 0;
  const monthlyUsed = row?.month_key === monthKey ? row.monthly_count : 0;
  if (dailyUsed >= DAILY_LIMIT) {
    return { allowed: false, status: 429, error: "You've reached today's AI analysis limit.", code: "DAILY_LIMIT", retryAfter: 0, usage: await getUsage(db, userId, now) };
  }
  if (monthlyUsed >= MONTHLY_LIMIT) {
    return { allowed: false, status: 429, error: "You've reached this month's AI analysis limit.", code: "MONTHLY_LIMIT", retryAfter: 0, usage: await getUsage(db, userId, now) };
  }

  const cooldownRemaining = row?.last_request_at
    ? MIN_REQUEST_INTERVAL_MS - (now - row.last_request_at)
    : 0;
  const minuteRemaining = row?.minute_window_start
    ? MINUTE_WINDOW_MS - (now - row.minute_window_start)
    : 0;
  const minuteLimitReached = minuteRemaining > 0 && (row?.minute_count || 0) >= MINUTE_LIMIT;
  const retryAfter = Math.max(1, Math.ceil((minuteLimitReached ? minuteRemaining : cooldownRemaining) / 1000));
  return {
    allowed: false,
    status: 429,
    error: "You're sending requests too quickly. Please wait a moment and try again.",
    code: "RATE_LIMITED",
    retryAfter,
    usage: await getUsage(db, userId, now),
  };
}


function razorpayConfigured(env) {
  return Boolean(env.RAZORPAY_API_KEY && env.RAZORPAY_SECRET);
}
function razorpayCredentials(env) {
  // Cloudflare secrets are supplied as strings. Trim accidental whitespace
  // before constructing the Basic Auth credential pair.
  const keyId = String(env.RAZORPAY_API_KEY || "").trim();
  const keySecret = String(env.RAZORPAY_SECRET || "").trim();
  if (!keyId || !keySecret) throw new Error("Razorpay API credentials are not configured.");
  return { keyId, keySecret };
}
function razorpayAuth(env) {
  const { keyId, keySecret } = razorpayCredentials(env);
  // Razorpay API keys are ASCII; Basic Auth encodes the literal KEY_ID:SECRET pair.
  return "Basic " + btoa(keyId + ":" + keySecret);
}
async function razorpayRequest(env, path, method = "GET", body) {
  const response = await fetch(`${RAZORPAY_API}${path}`, {
    method, headers: { Authorization: razorpayAuth(env), "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok) {
    const apiError = data?.error || data;
    const description = apiError?.description || apiError?.message || (raw ? raw.slice(0, 500) : "No response body");
    const code = apiError?.code ? ` [${apiError.code}]` : "";
    throw new Error(`Razorpay ${method} ${path} failed (HTTP ${response.status})${code}: ${description}`);
  }
  if (!data || typeof data !== "object") throw new Error(`Razorpay ${method} ${path} returned an invalid response.`);
  return data;
}
async function getOrCreatePlan(env, code) {
  const config = SUBSCRIPTION_PLANS[code];
  const existing = await env.DB.prepare("SELECT razorpay_plan_id FROM razorpay_plans WHERE plan_code = ?").bind(code).first();
  if (existing?.razorpay_plan_id) return existing.razorpay_plan_id;
  const plan = await razorpayRequest(env, "/plans", "POST", {
    period: config.period, interval: config.interval,
    item: { name: config.label, amount: config.amount, currency: "INR", description: "NutriTrack AI subscription" },
    notes: { product: "NutriTrack AI", plan_code: code },
  });
  await env.DB.prepare("INSERT OR IGNORE INTO razorpay_plans (plan_code, razorpay_plan_id, created_at) VALUES (?, ?, ?)")
    .bind(code, plan.id, Date.now()).run();
  const saved = await env.DB.prepare("SELECT razorpay_plan_id FROM razorpay_plans WHERE plan_code = ?").bind(code).first();
  return saved.razorpay_plan_id;
}
async function releaseAbandonedSubscription(env, userId, subscriptionId) {
  const claim = await env.DB.prepare(
    "SELECT provider_subscription_id FROM trial_claims WHERE user_id = ? AND provider = 'razorpay' AND provider_subscription_id = ? AND status = 'pending'"
  ).bind(userId, subscriptionId).first();
  if (!claim) return { released: false, reason: "not_pending" };

  // Confirm the provider-side state before releasing the local lock. Never
  // release an authenticated/active subscription just because Checkout closed.
  const remote = await razorpayRequest(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const status = String(remote.status || "").toLowerCase();
  const hasCustomer = Boolean(remote.customer_id);
  const authAttempts = Number(remote.auth_attempts || 0);
  const safeToRelease = !hasCustomer && authAttempts === 0
    && (status === "created" || status === "expired" || status === "cancelled");
  if (!safeToRelease) return { released: false, reason: "authorization_may_have_succeeded", status };

  if (status === "created") {
    // Do not clear the local lock unless Razorpay confirms the cancellation request.
    await razorpayRequest(env, `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, "POST", { cancel_at_cycle_end: 0 });
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE trial_claims SET status = 'expired' WHERE user_id = ? AND provider_subscription_id = ? AND status = 'pending'")
      .bind(userId, subscriptionId),
    env.DB.prepare("UPDATE user_entitlements SET status = 'demo', razorpay_subscription_id = NULL, plan_code = NULL, updated_at = ? WHERE user_id = ? AND razorpay_subscription_id = ? AND status = 'demo'")
      .bind(Date.now(), userId, subscriptionId),
  ]);
  return { released: true };
}

async function createSubscription(env, userId, code) {
  const access = await getAccess(env.DB, userId);
  if (access.status === "trialing" || access.status === "active") throw new Error("Your account already has premium access.");
  const pending = await env.DB.prepare("SELECT provider_subscription_id FROM trial_claims WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").bind(userId).first();
  if (pending) throw new Error("A subscription authorization is already pending for this account. Complete or wait for that checkout first.");
  const config = SUBSCRIPTION_PLANS[code];
  const planId = await getOrCreatePlan(env, code);
  const now = Math.floor(Date.now() / 1000);
  const startAt = now + 3 * 24 * 60 * 60;
  const subscription = await razorpayRequest(env, "/subscriptions", "POST", {
    plan_id: planId, total_count: config.totalCount, quantity: 1,
    customer_notify: true, start_at: startAt, expire_by: now + 24 * 60 * 60,
    notes: { user_id: userId, plan_code: code, trial_days: "3" },
  });
  await env.DB.prepare("INSERT INTO trial_claims (id, user_id, provider, provider_subscription_id, started_at, ends_at, status, created_at) VALUES (?, ?, 'razorpay', ?, ?, ?, 'pending', ?)")
    .bind(crypto.randomUUID(), userId, subscription.id, now * 1000, startAt * 1000, Date.now()).run();
  await env.DB.prepare("INSERT INTO user_entitlements (user_id, status, plan_code, razorpay_subscription_id, updated_at) VALUES (?, 'demo', ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET plan_code = excluded.plan_code, razorpay_subscription_id = excluded.razorpay_subscription_id, updated_at = excluded.updated_at")
    .bind(userId, code, subscription.id, Date.now()).run();
  return { id: subscription.id, key: env.RAZORPAY_API_KEY, planCode: code, amount: config.amount, currency: "INR", startAt: startAt * 1000, shortUrl: subscription.short_url || null };
}
async function verifyWebhookSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
async function cancelRazorpaySubscription(env, id) {
  try { await razorpayRequest(env, `/subscriptions/${encodeURIComponent(id)}/cancel`, "POST", { cancel_at_cycle_end: 0 }); } catch {}
}
async function handleRazorpayWebhook(request, env) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return json({ error: "Webhook secret is not configured." }, 503);
  const raw = await request.text();
  if (raw.length > 256_000) return json({ error: "Payload too large." }, 413);
  const signature = request.headers.get("x-razorpay-signature") || "";
  if (!await verifyWebhookSignature(raw, signature, env.RAZORPAY_WEBHOOK_SECRET)) return json({ error: "Invalid webhook signature." }, 401);
  let event; try { event = JSON.parse(raw); } catch { return json({ error: "Invalid webhook payload." }, 400); }
  const eventId = request.headers.get("x-razorpay-event-id") || event.id;
  if (!eventId) return json({ error: "Missing event identifier." }, 400);
  const subscription = event.payload?.subscription?.entity;
  const subscriptionId = subscription?.id;
  // Checkout verifies the initial authorization; payment.authorized is not needed here.
  if (!subscriptionId) return json({ ok: true, ignored: true });
  const prior = await env.DB.prepare("SELECT provider_event_id FROM subscription_events WHERE provider_event_id = ?").bind(eventId).first();
  if (prior) return json({ ok: true, duplicate: true });
  const claim = await env.DB.prepare("SELECT user_id FROM trial_claims WHERE provider_subscription_id = ?").bind(subscriptionId).first();
  if (!claim) return json({ ok: true, ignored: true });
  const userId = claim.user_id, now = Date.now(), eventType = event.event || "unknown";
  const statements = [];
  if (["subscription.activated", "subscription.charged", "subscription.resumed"].includes(eventType)) {
    const paidUntil = Number(subscription.current_end || subscription.charge_at || 0) * 1000 || null;
    statements.push(env.DB.prepare("UPDATE user_entitlements SET status = 'active', paid_until = COALESCE(?, paid_until), updated_at = ? WHERE user_id = ? AND razorpay_subscription_id = ?").bind(paidUntil, now, userId, subscriptionId));
    statements.push(env.DB.prepare("UPDATE trial_claims SET status = 'converted' WHERE provider_subscription_id = ?").bind(subscriptionId));
  } else if (["subscription.pending", "subscription.halted", "subscription.paused"].includes(eventType)) {
    statements.push(env.DB.prepare("UPDATE user_entitlements SET status = 'past_due', updated_at = ? WHERE user_id = ? AND razorpay_subscription_id = ?").bind(now, userId, subscriptionId));
  } else if (eventType === "subscription.cancelled") {
    statements.push(env.DB.prepare("UPDATE user_entitlements SET status = 'cancelled', cancel_at_period_end = 0, updated_at = ? WHERE user_id = ? AND razorpay_subscription_id = ?").bind(now, userId, subscriptionId));
    statements.push(env.DB.prepare("UPDATE trial_claims SET status = 'cancelled' WHERE provider_subscription_id = ? AND status IN ('pending', 'trialing')").bind(subscriptionId));
  } else if (eventType === "subscription.completed") {
    statements.push(env.DB.prepare("UPDATE user_entitlements SET status = 'expired', cancel_at_period_end = 0, updated_at = ? WHERE user_id = ? AND razorpay_subscription_id = ?").bind(now, userId, subscriptionId));
    statements.push(env.DB.prepare("UPDATE trial_claims SET status = 'converted' WHERE provider_subscription_id = ?").bind(subscriptionId));
  }
  statements.push(env.DB.prepare("INSERT INTO subscription_events (provider_event_id, provider, event_type, processed_at) VALUES (?, 'razorpay', ?, ?)").bind(eventId, eventType, now));
  try { await env.DB.batch(statements); return json({ ok: true }); }
  catch (error) { console.error("Could not process Razorpay subscription webhook", { subscriptionId, event: eventType, message: error.message }); return json({ error: "Could not process subscription event." }, 500); }
}

async function verifySubscriptionCheckoutSignature(paymentId, subscriptionId, signature, secret) {
  if (!paymentId || !subscriptionId || !signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(paymentId + "|" + subscriptionId));
  const expected = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

async function callGemini(env, model, prompt, test = false, imageAttachments = []) {
  const parts = [{ text: prompt }, ...imageAttachments.map((image) => ({
    inlineData: { mimeType: image.mimeType, data: image.data }
  }))];
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: test
          ? { temperature: 0 }
          : { temperature: 0.2, responseMimeType: "application/json" },
      }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status === 429
      ? "AI service is busy. Please try again shortly."
      : response.status === 403 || response.status === 401
        ? "AI service configuration error. Please contact support."
        : "Could not analyse this meal right now.";
    return { error: message, status: response.status };
  }
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  if (!text) return { error: "The AI returned an empty response. Please try again.", status: 502 };
  return { text };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (url.pathname === "/api/internal/session-revoked" && request.method === "POST") {
      const supplied = request.headers.get("x-internal-secret") || "";
      const expected = String(env.SESSION_REVOCATION_SECRET || "");
      if (!expected || supplied !== expected) return json({ error: "Not found." }, 404);
      let body; try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
      const uid = typeof body.uid === "string" ? body.uid : "";
      const revokedAfter = Number(body.revokedAfter);
      if (!uid || uid.length > 128 || !Number.isSafeInteger(revokedAfter) || revokedAfter <= 0) return json({ error: "Invalid revocation record." }, 400);
      if (!env.DB) return json({ error: "Account service is not configured." }, 503);
      await env.DB.prepare("INSERT INTO session_revocations (user_id, revoked_after, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET revoked_after = MAX(session_revocations.revoked_after, excluded.revoked_after), updated_at = excluded.updated_at").bind(uid, revokedAfter, Date.now()).run();
      const stored = await env.DB.prepare("SELECT revoked_after FROM session_revocations WHERE user_id = ?").bind(uid).first();
      if (!stored || Number(stored.revoked_after) < revokedAfter) {
        console.error("Session revocation write could not be confirmed", { databaseBinding: "DB" });
        return json({ error: "Session revocation write could not be confirmed." }, 503);
      }
      return json({ ok: true, confirmed: true, revokedAfter: Number(stored.revoked_after) });
    }
    if (url.pathname === "/api/razorpay-webhook" && request.method === "POST") return handleRazorpayWebhook(request, env);
    const allowedPaths = ["/api/meal-analysis", "/api/demo-analysis", "/api/ai-status", "/api/usage", "/api/access", "/api/barcode-lookup", "/api/create-subscription", "/api/verify-subscription", "/api/cancel-subscription", "/api/abandon-subscription", "/api/delete-account-data"];
    if (request.method !== "POST" || !allowedPaths.includes(url.pathname)) {
      return json({ error: "Not found." }, 404);
    }

    const missingConfig = [];
    if (!env.FIREBASE_PROJECT_ID) missingConfig.push("FIREBASE_PROJECT_ID");
    if (["/api/meal-analysis", "/api/demo-analysis", "/api/ai-status"].includes(url.pathname) && !env.GEMINI_API_KEY) missingConfig.push("GEMINI_API_KEY");
    if (!env.DB) missingConfig.push("DB");
    if (["/api/create-subscription", "/api/verify-subscription", "/api/cancel-subscription", "/api/abandon-subscription"].includes(url.pathname) && !razorpayConfigured(env)) missingConfig.push("RAZORPAY_API_KEY/RAZORPAY_SECRET");
    if (missingConfig.length) {
      const geminiPath = ["/api/meal-analysis", "/api/demo-analysis", "/api/ai-status"].includes(url.pathname);
      const subscriptionPath = ["/api/create-subscription", "/api/verify-subscription", "/api/cancel-subscription", "/api/abandon-subscription", "/api/delete-account-data"].includes(url.pathname);
      const message = geminiPath ? "Gemini AI is not configured on this Preview deployment." : subscriptionPath ? "Razorpay subscription service is not configured on this Preview deployment." : "Account service is not configured on this Preview deployment.";
      return json({ error: message, missing: missingConfig }, 503);
    }

    let identity;
    try { identity = await authenticate(request, env.FIREBASE_PROJECT_ID); }
    catch { return json({ error: "Please sign in again before using AI meal analysis." }, 401); }
    const userId = identity.uid;
    try {
      const revocation = await env.DB.prepare("SELECT revoked_after FROM session_revocations WHERE user_id = ?").bind(userId).first();
      if (revocation && identity.authTime < Number(revocation.revoked_after)) return json({ error: "Your session was signed out from another device. Please sign in again.", code: "SESSION_REVOKED" }, 401);
    } catch { return json({ error: "Account security checks are temporarily unavailable. Please try again." }, 503); }

    if (url.pathname === "/api/barcode-lookup") {
      let body;
      try {
        const raw = await request.text();
        if (raw.length > 2048) return json({ error: "Barcode lookup request is too large." }, 413);
        body = JSON.parse(raw);
      } catch { return json({ error: "Invalid barcode lookup request." }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid barcode lookup request." }, 400);
      const barcode = normalizeRetailBarcode(body.barcode);
      if (!barcode) return json({ error: "Enter a valid UPC-A, EAN-8, EAN-13 or GTIN-14 barcode." }, 400);
      try {
        const fields = "code,status,product_name,product_name_en,brands,quantity,categories,countries_tags,image_front_small_url,nutriments";
        const countryCode = typeof body.countryCode === "string" && /^[A-Za-z]{2}$/.test(body.countryCode) ? body.countryCode.toUpperCase() : "IN";
      if (countryCode === "US" && env.FDC_API_KEY) {
        try {
          const apiKey = encodeURIComponent(env.FDC_API_KEY);
          const searchResponse = await fetch("https://api.nal.usda.gov/fdc/v1/foods/search?api_key=" + apiKey, {
            method: "POST",
            headers: { "content-type": "application/json", "accept": "application/json" },
            body: JSON.stringify({ query: barcode, dataType: ["Branded"], pageSize: 10 }),
            signal: AbortSignal.timeout(9000)
          });
          if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            const canonical = value => String(value || "").replace(/\D/g, "").replace(/^0+/, "");
            const matches = (Array.isArray(searchData.foods) ? searchData.foods : [])
              .filter(item => canonical(item.gtinUpc) === canonical(barcode))
              .sort((a, b) => Date.parse(b.publicationDate || b.modifiedDate || "") - Date.parse(a.publicationDate || a.modifiedDate || ""));
            if (matches.length) {
              const fdcId = Number(matches[0].fdcId);
              if (Number.isInteger(fdcId) && fdcId > 0) {
                const detailResponse = await fetch("https://api.nal.usda.gov/fdc/v1/food/" + fdcId + "?api_key=" + apiKey, {
                  headers: { "accept": "application/json" },
                  signal: AbortSignal.timeout(9000)
                });
                if (detailResponse.ok) {
                  const food = await detailResponse.json();
                  const product = normalizeUsdaFood(food, barcode);
                  if (product) {
                    product.sourceRecordDate = food.publicationDate || food.modifiedDate || matches[0].publicationDate || null;
                    return json({ ok: true, product });
                  }
                }
              }
            }
          }
        } catch (error) {
          console.warn("USDA barcode lookup unavailable; falling back to Open Food Facts", { message: error?.message || "unknown" });
        }
      }
        const upstream = await fetch("https://world.openfoodfacts.org/api/v3/product/" + encodeURIComponent(barcode) + "?cc=" + countryCode + "&fields=" + fields, {
          headers: { "accept": "application/json", "user-agent": "NutriTrackAI/1.0 (https://github.com/ArjunIsCool/nutritrack-ai)" },
          signal: AbortSignal.timeout(9000)
        });
        if (!upstream.ok) return json({ error: "The product catalogue is temporarily unavailable. Try again later." }, 502);
        const data = await upstream.json();
        if (!["success", "success_with_warnings"].includes(data?.status) || !data.product) return json({ error: "No product was found for this barcode. You can still log the food manually." }, 404);
        const product = normalizeOpenFoodFactsProduct(data.product, barcode);
        if (!product) return json({ error: "A product record exists, but it has no reliable product name. Please check the barcode." }, 422);
        return json({ ok: true, product });
      } catch (error) {
        console.error("Barcode catalogue lookup failed", { message: error?.message || "unknown" });
        return json({ error: "Could not reach the product catalogue. Check your connection and try again." }, 502);
      }
    }

    if (url.pathname === "/api/create-subscription" || url.pathname === "/api/verify-subscription" || url.pathname === "/api/cancel-subscription" || url.pathname === "/api/abandon-subscription" || url.pathname === "/api/delete-account-data") {
      let body; try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
      if (url.pathname === "/api/delete-account-data") {
        try {
          const entitlement = await env.DB.prepare(
            "SELECT razorpay_subscription_id FROM user_entitlements WHERE user_id = ?"
          ).bind(userId).first();
          const subscriptionId = entitlement?.razorpay_subscription_id;
          if (subscriptionId) {
            if (!razorpayConfigured(env)) throw new Error("Razorpay credentials are required to cancel the linked subscription.");
            const remote = await razorpayRequest(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
            const status = String(remote.status || "").toLowerCase();
            if (!["cancelled", "completed", "expired"].includes(status)) {
              await razorpayRequest(
                env,
                `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
                "POST",
                { cancel_at_cycle_end: 0 }
              );
            }
          }
          await env.DB.batch([
            env.DB.prepare("DELETE FROM trial_claims WHERE user_id = ?").bind(userId),
            env.DB.prepare("DELETE FROM payment_methods WHERE user_id = ?").bind(userId),
            env.DB.prepare("DELETE FROM demo_usage WHERE user_id = ?").bind(userId),
            env.DB.prepare("DELETE FROM ai_usage WHERE user_id = ?").bind(userId),
            env.DB.prepare("DELETE FROM user_entitlements WHERE user_id = ?").bind(userId),
            env.DB.prepare("DELETE FROM session_revocations WHERE user_id = ?").bind(userId)
          ]);
          return json({ ok: true, subscriptionCancelled: Boolean(subscriptionId) });
        } catch (error) {
          console.error("Account data deletion failed", { userId, message: error.message });
          return json({
            error: "We couldn't safely finish account deletion. Your sign-in account has not been deleted; please retry or contact support."
          }, 502);
        }
      }
      if (url.pathname === "/api/verify-subscription") {
        const subscriptionId = typeof body.subscriptionId === "string" ? body.subscriptionId : "";
        const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
        const signature = typeof body.signature === "string" ? body.signature : "";
        if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId) || !/^pay_[A-Za-z0-9]+$/.test(paymentId) || !signature) return json({ error: "Invalid Razorpay Checkout response." }, 400);
        try {
          const claim = await env.DB.prepare("SELECT user_id, provider_subscription_id, ends_at, status FROM trial_claims WHERE user_id = ? AND provider_subscription_id = ? AND provider = 'razorpay'").bind(userId, subscriptionId).first();
          if (!claim) return json({ error: "Subscription was not found for this account." }, 404);
          if (!await verifySubscriptionCheckoutSignature(paymentId, claim.provider_subscription_id, signature, razorpayCredentials(env).keySecret)) return json({ error: "Razorpay payment verification failed." }, 400);
          if (claim.status === "trialing" || claim.status === "converted") return json({ ok: true, alreadyVerified: true });
          if (claim.status !== "pending") return json({ error: "This subscription is no longer pending." }, 409);
          const now = Date.now();
          await env.DB.batch([
            env.DB.prepare("UPDATE trial_claims SET status = 'trialing' WHERE user_id = ? AND provider_subscription_id = ? AND status = 'pending'").bind(userId, subscriptionId),
            env.DB.prepare("UPDATE user_entitlements SET status = 'trialing', trial_started_at = ?, trial_ends_at = ?, razorpay_subscription_id = ?, updated_at = ? WHERE user_id = ? AND razorpay_subscription_id = ?").bind(now, claim.ends_at, subscriptionId, now, userId, subscriptionId)
          ]);
          return json({ ok: true, trialEndsAt: claim.ends_at });
        } catch (error) {
          console.error("Razorpay Checkout verification failed", { subscriptionId, message: error.message });
          return json({ error: "Could not verify the subscription right now. Please try again." }, 503);
        }
      }
      if (url.pathname === "/api/abandon-subscription") {
        const subscriptionId = typeof body.subscriptionId === "string" ? body.subscriptionId : "";
        if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) return json({ error: "Invalid subscription reference." }, 400);
        try {
          const result = await releaseAbandonedSubscription(env, userId, subscriptionId);
          return json({ ok: true, ...result });
        } catch (error) {
          console.error("Could not reconcile abandoned Razorpay subscription", { message: error.message });
          return json({ error: "Could not safely release this checkout yet. Please try again shortly." }, 502);
        }
      }
      if (url.pathname === "/api/create-subscription") {
        const code = body.planCode;
        if (!Object.hasOwn(SUBSCRIPTION_PLANS, code)) return json({ error: "Choose a valid subscription plan." }, 400);
        try { return json({ ok: true, checkout: await createSubscription(env, userId, code) }); }
        catch (error) {
          console.error("Razorpay subscription creation failed", { message: error.message, planCode: code });
          return json({ error: error.message || "Could not start checkout." }, 502);
        }
      }
      const row = await env.DB.prepare("SELECT razorpay_subscription_id FROM user_entitlements WHERE user_id = ?").bind(userId).first();
      if (!row?.razorpay_subscription_id) return json({ error: "No subscription is linked to this account." }, 404);
      try {
        await razorpayRequest(env, `/subscriptions/${encodeURIComponent(row.razorpay_subscription_id)}/cancel`, "POST", { cancel_at_cycle_end: 1 });
        return json({ ok: true, message: "Cancellation requested. Access remains subject to the current paid/trial period." });
      } catch (error) { return json({ error: error.message || "Could not cancel subscription." }, 502); }
    }

    if (url.pathname === "/api/access") {
      try {
        const [access, demoUsage] = await Promise.all([getAccess(env.DB, userId), getDemoUsage(env.DB, userId)]);
        return json({ ok: true, access, demoUsage });
      } catch { return json({ error: "Could not load account access right now." }, 503); }
    }

    if (url.pathname === "/api/usage") {
      try {
        return json({ ok: true, usage: await getUsage(env.DB, userId) });
      } catch {
        return json({ error: "Could not load AI usage right now." }, 503);
      }
    }

    let body;
    try {
      const raw = await request.text();
      if (raw.length > 9_000_000) return json({ error: "The request is too large. Please use smaller photos." }, 413);
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid request body." }, 400);
    }

    const model = typeof body.model === "string" && MODEL_ALLOWLIST.has(body.model)
      ? body.model
      : "gemini-3.5-flash-lite";

    if (url.pathname === "/api/ai-status") {
      if (!await hasPremiumAccess(env.DB, userId)) return json({ error: "AI service testing is available during a trial or paid subscription." }, 402);
      const result = await callGemini(env, model, "Reply with exactly: NutriTrack AI connection successful.", true);
      return result.error ? json({ error: result.error }, result.status) : json({ ok: true });
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const category = typeof body.category === "string" ? body.category.slice(0, 30) : "Meal";
    const countryCode = typeof body.countryCode === "string" && /^[A-Za-z]{2}$/.test(body.countryCode)
      ? body.countryCode.toUpperCase()
      : "IN";
    const imageValidation = validateImageAttachments(body.imageAttachments);
    if (!imageValidation.ok) return json({ error: imageValidation.error }, imageValidation.status);
    const imageAttachments = imageValidation.images;
    if ((!prompt && imageAttachments.length === 0) || prompt.length > 4000) {
      return json({ error: "Enter a short meal description or attach at least one photo." }, 400);
    }

    if (url.pathname === "/api/demo-analysis") {
      const access = await getAccess(env.DB, userId);
      if (access.status === "trialing" || access.status === "active") {
        return json({ error: "Your account already has premium access. Use standard meal analysis.", code: "PREMIUM_ACTIVE" }, 409);
      }
      let demoReservation;
      try { demoReservation = await reserveDemo(env.DB, userId); }
      catch { return json({ error: "Demo usage controls are unavailable. Please try again." }, 503); }
      if (!demoReservation.allowed) return json(demoReservation, demoReservation.status);
      const demoResult = await callGemini(env, model, makeMealPrompt(prompt, category, countryCode), false, imageAttachments);
      if (demoResult.error) {
        try { await refundDemo(env.DB, userId); } catch {}
        return json({ error: demoResult.error, demoUsage: await getDemoUsage(env.DB, userId) }, demoResult.status);
      }
      return json({ text: demoResult.text, demoUsage: demoReservation.usage, access });
    }

    if (!await hasPremiumAccess(env.DB, userId)) {
      return json({ error: "Your demo analyses are used or your trial has ended. Start a trial or subscribe to continue.", code: "SUBSCRIPTION_REQUIRED" }, 402);
    }

    let reservation;
    try {
      reservation = await reserveAnalysis(env.DB, userId);
    } catch {
      return json({ error: "Usage controls are temporarily unavailable. Please try again shortly." }, 503);
    }
    if (!reservation.allowed) {
      return json({
        error: reservation.error,
        code: reservation.code,
        retryAfter: reservation.retryAfter,
        usage: reservation.usage,
      }, reservation.status);
    }

    const result = await callGemini(env, model, makeMealPrompt(prompt, category, countryCode), false, imageAttachments);
    if (result.error) {
      try {
        await refundAnalysis(env.DB, userId);
        const usage = await getUsage(env.DB, userId);
        return json({ error: result.error, usage }, result.status);
      } catch {
        return json({ error: result.error, usage: reservation.usage }, result.status);
      }
    }
    return json({ text: result.text, usage: reservation.usage });
  },
};
