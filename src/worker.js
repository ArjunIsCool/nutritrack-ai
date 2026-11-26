import { createRemoteJWKSet, jwtVerify } from "jose";

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
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("Your sign-in session is invalid. Please sign in again.");
  }
  return payload.sub;
}

function makeMealPrompt(prompt, category) {
  return `You are a careful nutrition estimation assistant for an Indian user. Analyze this meal: "${prompt.replace(/"/g, '\\"')}". Meal category selected: ${category}. Return ONLY valid JSON with this exact structure: {"meal_name":"short title","items":[{"name":"food and portion","calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0}],"totals":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0},"quality":"Good|Moderate|Occasional","assessment":"2-3 concise sentences","assumptions":["portion assumptions"],"needs_clarification":false,"clarifying_question":""}. Use realistic estimates, metric quantities, and account for cooking oil where possible. Values must be numbers. Do not claim exactness. If portion ambiguity materially changes the estimate, set needs_clarification true and ask one concise question; still provide a provisional estimate. Do not give medical diagnoses.`;
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
function razorpayAuth(env) {
  return "Basic " + btoa(unescape(encodeURIComponent(env.RAZORPAY_API_KEY + ":" + env.RAZORPAY_SECRET)));
}
async function razorpayRequest(env, path, method = "GET", body) {
  const response = await fetch(`${RAZORPAY_API}${path}`, {
    method, headers: { Authorization: razorpayAuth(env), "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.description || "Razorpay request failed.");
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
  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: "Invalid webhook payload." }, 400); }
  const eventId = request.headers.get("x-razorpay-event-id") || event.id;
  if (!eventId) return json({ error: "Missing event identifier." }, 400);
  const claim = event.payload?.subscription?.entity || {};
  const payment = event.payload?.payment?.entity || {};
  const subId = claim.id || payment.subscription_id;
  if (!subId) return json({ ok: true, ignored: true });
  const pending = await env.DB.prepare("SELECT user_id, started_at, ends_at FROM trial_claims WHERE provider_subscription_id = ?").bind(subId).first();
  if (!pending) return json({ ok: true, ignored: true });
  const inserted = await env.DB.prepare("INSERT OR IGNORE INTO subscription_events (provider_event_id, provider, event_type, processed_at) VALUES (?, 'razorpay', ?, ?)")
    .bind(eventId, event.event || "unknown", Date.now()).run();
  if (!inserted.meta?.changes) return json({ ok: true, duplicate: true });
  const userId = pending.user_id;
  if (event.event === "payment.authorized" || event.event === "subscription.authenticated") {
    const method = payment.method || claim.payment_method;
    const cardId = payment.card_id || claim.card_id;
    if (method !== "card" || !cardId) {
      await env.DB.prepare("UPDATE trial_claims SET status = 'rejected' WHERE provider_subscription_id = ?").bind(subId).run();
      await cancelRazorpaySubscription(env, subId);
      return json({ ok: true, rejected: "card_identifier_unavailable" });
    }
    const existing = await env.DB.prepare("SELECT user_id FROM payment_methods WHERE provider = 'razorpay' AND provider_payment_method_id = ?").bind(cardId).first();
    if (existing) {
      await env.DB.prepare("UPDATE trial_claims SET status = 'rejected', provider_payment_method_id = ? WHERE provider_subscription_id = ?").bind(cardId, subId).run();
      await cancelRazorpaySubscription(env, subId);
      return json({ ok: true, rejected: "payment_method_already_used" });
    }
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO payment_methods (provider, provider_payment_method_id, user_id, first_seen_at, trial_claimed_at) VALUES ('razorpay', ?, ?, ?, ?)").bind(cardId, userId, Date.now(), Date.now()),
        env.DB.prepare("UPDATE trial_claims SET provider_payment_method_id = ?, status = 'trialing' WHERE provider_subscription_id = ?").bind(cardId, subId),
        env.DB.prepare("UPDATE user_entitlements SET status = 'trialing', trial_started_at = ?, trial_ends_at = ?, plan_code = (SELECT plan_code FROM user_entitlements WHERE user_id = ?), razorpay_subscription_id = ?, updated_at = ? WHERE user_id = ?").bind(Date.now(), pending.ends_at, userId, subId, Date.now(), userId),
      ]);
    } catch {
      await cancelRazorpaySubscription(env, subId);
      return json({ error: "Could not register trial eligibility." }, 500);
    }
  } else if (event.event === "subscription.activated" || event.event === "subscription.charged") {
    const end = Number(claim.current_end || claim.charge_at || 0) * 1000 || Date.now() + 30 * 86400000;
    await env.DB.prepare("UPDATE user_entitlements SET status = 'active', paid_until = ?, updated_at = ? WHERE user_id = ? AND razorpay_subscription_id = ?")
      .bind(end, Date.now(), userId, subId).run();
    await env.DB.prepare("UPDATE trial_claims SET status = 'converted' WHERE provider_subscription_id = ?").bind(subId).run();
  } else if (event.event === "subscription.halted") {
    await env.DB.prepare("UPDATE user_entitlements SET status = 'past_due', updated_at = ? WHERE user_id = ? AND razorpay_subscription_id = ?").bind(Date.now(), userId, subId).run();
  } else if (event.event === "subscription.cancelled" || event.event === "subscription.completed") {
    await env.DB.prepare("UPDATE user_entitlements SET status = 'cancelled', cancel_at_period_end = 0, updated_at = ? WHERE user_id = ? AND razorpay_subscription_id = ?").bind(Date.now(), userId, subId).run();
    await env.DB.prepare("UPDATE trial_claims SET status = CASE WHEN status = 'trialing' THEN 'cancelled' ELSE status END WHERE provider_subscription_id = ?").bind(subId).run();
  }
  return json({ ok: true });
}

async function callGemini(env, model, prompt, test = false) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
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

    if (url.pathname === "/api/razorpay-webhook" && request.method === "POST") return handleRazorpayWebhook(request, env);
    const allowedPaths = ["/api/meal-analysis", "/api/demo-analysis", "/api/ai-status", "/api/usage", "/api/access", "/api/create-subscription", "/api/cancel-subscription"];
    if (request.method !== "POST" || !allowedPaths.includes(url.pathname)) {
      return json({ error: "Not found." }, 404);
    }

    const missingConfig = [];
    if (!env.FIREBASE_PROJECT_ID) missingConfig.push("FIREBASE_PROJECT_ID");
    if (["/api/meal-analysis", "/api/demo-analysis", "/api/ai-status"].includes(url.pathname) && !env.GEMINI_API_KEY) missingConfig.push("GEMINI_API_KEY");
    if (!env.DB) missingConfig.push("DB");
    if (["/api/create-subscription", "/api/cancel-subscription"].includes(url.pathname) && !razorpayConfigured(env)) missingConfig.push("RAZORPAY_API_KEY/RAZORPAY_SECRET");
    if (missingConfig.length) {
      const geminiPath = ["/api/meal-analysis", "/api/demo-analysis", "/api/ai-status"].includes(url.pathname);
      const subscriptionPath = ["/api/create-subscription", "/api/cancel-subscription"].includes(url.pathname);
      const message = geminiPath ? "Gemini AI is not configured on this Preview deployment." : subscriptionPath ? "Razorpay subscription service is not configured on this Preview deployment." : "Account service is not configured on this Preview deployment.";
      return json({ error: message, missing: missingConfig }, 503);
    }

    let userId;
    try {
      userId = await authenticate(request, env.FIREBASE_PROJECT_ID);
    } catch {
      return json({ error: "Please sign in again before using AI meal analysis." }, 401);
    }

    if (url.pathname === "/api/create-subscription" || url.pathname === "/api/cancel-subscription") {
      let body; try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
      if (url.pathname === "/api/create-subscription") {
        const code = body.planCode;
        if (!Object.hasOwn(SUBSCRIPTION_PLANS, code)) return json({ error: "Choose a valid subscription plan." }, 400);
        try { return json({ ok: true, checkout: await createSubscription(env, userId, code) }); }
        catch (error) { return json({ error: error.message || "Could not start checkout." }, 502); }
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
      if (raw.length > 12000) return json({ error: "Request is too large." }, 413);
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
    if (!prompt || prompt.length > 4000) {
      return json({ error: "Please enter a meal description under 4,000 characters." }, 400);
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
      const demoResult = await callGemini(env, model, makeMealPrompt(prompt, category));
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

    const result = await callGemini(env, model, makeMealPrompt(prompt, category));
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
