import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

const MODEL_ALLOWLIST = new Set([
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
]);

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

    if (request.method !== "POST" || !["/api/meal-analysis", "/api/ai-status"].includes(url.pathname)) {
      return json({ error: "Not found." }, 404);
    }

    if (!env.FIREBASE_PROJECT_ID || !env.GEMINI_API_KEY) {
      return json({ error: "AI service is not configured yet." }, 503);
    }

    try {
      await authenticate(request, env.FIREBASE_PROJECT_ID);
    } catch {
      return json({ error: "Please sign in again before using AI meal analysis." }, 401);
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
      : "gemini-2.5-flash";

    if (url.pathname === "/api/ai-status") {
      const result = await callGemini(env, model, "Reply with exactly: NutriTrack AI connection successful.", true);
      return result.error ? json({ error: result.error }, result.status) : json({ ok: true });
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const category = typeof body.category === "string" ? body.category.slice(0, 30) : "Meal";
    if (!prompt || prompt.length > 4000) {
      return json({ error: "Please enter a meal description under 4,000 characters." }, 400);
    }

    const result = await callGemini(env, model, makeMealPrompt(prompt, category));
    return result.error ? json({ error: result.error }, result.status) : json({ text: result.text });
  },
};
