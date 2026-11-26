import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

const MODEL_ALLOWLIST = new Set(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
const DAILY_LIMIT = 10;
const MONTHLY_LIMIT = 100;
const MINUTE_LIMIT = 6;
const MIN_REQUEST_INTERVAL_MS = 5000;
const MINUTE_WINDOW_MS = 60_000;

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

    const allowedPaths = ["/api/meal-analysis", "/api/ai-status", "/api/usage"];
    if (request.method !== "POST" || !allowedPaths.includes(url.pathname)) {
      return json({ error: "Not found." }, 404);
    }

    const missingConfig = [];
    if (!env.FIREBASE_PROJECT_ID) missingConfig.push("FIREBASE_PROJECT_ID");
    if (!env.GEMINI_API_KEY) missingConfig.push("GEMINI_API_KEY");
    if (url.pathname !== "/api/ai-status" && !env.DB) missingConfig.push("DB");
    if (missingConfig.length) {
      return json({ error: "AI service is not configured yet.", missing: missingConfig }, 503);
    }

    let userId;
    try {
      userId = await authenticate(request, env.FIREBASE_PROJECT_ID);
    } catch {
      return json({ error: "Please sign in again before using AI meal analysis." }, 401);
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
      const result = await callGemini(env, model, "Reply with exactly: NutriTrack AI connection successful.", true);
      return result.error ? json({ error: result.error }, result.status) : json({ ok: true });
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const category = typeof body.category === "string" ? body.category.slice(0, 30) : "Meal";
    if (!prompt || prompt.length > 4000) {
      return json({ error: "Please enter a meal description under 4,000 characters." }, 400);
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
      return json({ error: result.error, usage: reservation.usage }, result.status);
    }
    return json({ text: result.text, usage: reservation.usage });
  },
};
