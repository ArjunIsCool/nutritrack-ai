# Firebase setup for NutriTrack AI

The app remains usable in local-only mode until Firebase environment variables are configured.

## 1. Create/configure a Firebase project
1. Open https://console.firebase.google.com/ and create a project.
2. Add a Web app and copy its configuration values.
3. Enable **Authentication → Sign-in method → Google**.
4. In Authentication → Settings → Authorized domains, add your Cloudflare Pages hostname and custom domain.
5. Create a **Cloud Firestore** database.

## 2. Configure the app
Copy `.env.example` to `.env.local` and fill in the Firebase Web App values. For Cloudflare Pages, add the same `VITE_FIREBASE_*` variables under Settings → Variables and Secrets, then trigger a new deployment.

These are public Firebase web-app configuration values, not admin credentials. Never put a service-account JSON, private key, Razorpay secret, or Gemini server key in a `VITE_*` variable.

## 3. Firestore security rules
Publish the contents of `firestore.rules` in Firebase Console → Firestore Database → Rules. The rules restrict every user to their own `users/{uid}` path.

## 4. Data behavior
- Existing local profile, meal history and weight records remain in the browser.
- On first Google sign-in, if the account has no cloud data, the current browser data is uploaded.
- If cloud data already exists, it is downloaded and becomes the account's current data on that device.
- Subsequent changes sync to Firestore. Keep using Settings → Export backup as an additional backup.
- Signing out leaves the browser's local copy intact.

## 5. Launch checks
Test Google sign-in on the deployed HTTPS domain, confirm Firestore rules are published, and verify that two devices signed into the same account see the same records. Configure Firebase budget alerts/usage monitoring. Do not launch paid subscriptions until server-side AI proxying and payment verification are implemented.

## 6. Managed AI service (Worker)

Meal analysis now calls the same-origin `/api/meal-analysis` endpoint. The Cloudflare Worker verifies the Firebase ID token before forwarding the prompt to Gemini. The Gemini API key is not sent to or stored in the browser.

Configure these bindings for both Preview and Production deployments in Cloudflare Workers → Settings → Variables and Secrets:

- `FIREBASE_PROJECT_ID` — a plain-text variable containing the Firebase project ID (the same value as `VITE_FIREBASE_PROJECT_ID`).
- `GEMINI_API_KEY` — a **Secret** containing the Gemini API key from Google AI Studio.

Do not add `GEMINI_API_KEY` as a `VITE_*` variable. After adding the bindings, redeploy the feature branch and test **Settings → NutriTrack AI → Test AI service** while signed in with Google.

The Worker uses Firebase's public signing keys to verify ID tokens and checks the token issuer and audience against `FIREBASE_PROJECT_ID`.

## 7. AI usage controls (Cloudflare D1)

The Worker now enforces server-side AI analysis limits. The initial limits are 10 analyses per user per UTC day and 100 per user per UTC calendar month, with a maximum of 6 requests per rolling minute window and a minimum 5-second interval between requests. A submitted analysis attempt reserves quota before calling Gemini, including attempts where Gemini subsequently returns an error. The usage counters are keyed by the authenticated Firebase UID; they are not client-editable.

Create a D1 database and apply the migration:

```bash
npx wrangler d1 create nutritrack-ai-usage
npx wrangler d1 migrations apply nutritrack-ai-usage --remote
```

The create command prints a database ID. Put that exact ID in `wrangler.jsonc` under `d1_databases[0].database_id`, replacing `REPLACE_WITH_D1_DATABASE_ID`. Keep the binding name as `DB` and the migration directory as `migrations`. Commit the real ID in the Wrangler config (the ID is an identifier, not a secret), then allow Cloudflare to deploy the Preview again.

The app calls the authenticated `POST /api/usage` endpoint to display daily and monthly usage. If the D1 binding is missing or the migration has not been applied, meal analysis fails closed with a service-unavailable response; it will not bypass the quota controls.

To inspect the database:

```bash
npx wrangler d1 execute nutritrack-ai-usage --remote --command "SELECT * FROM ai_usage"
```

The daily and monthly limits are constants in `src/worker.js` (`DAILY_LIMIT` and `MONTHLY_LIMIT`). Change them only on the server. These controls are a first protective layer, not a complete paid-subscription or enterprise abuse-prevention system. Subscription entitlement checks, payment verification, Firebase token-revocation checks, and broader abuse monitoring remain launch requirements.
