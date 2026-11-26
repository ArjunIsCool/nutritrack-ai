# Firebase setup for NutriTrack AI

A Firebase account is required to use NutriTrack AI. The app no longer offers guest or local-only access.

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

## 4. Account data behavior
- Users must sign in before entering the app.
- Firestore stores profile, meals and weight history under the authenticated UID.
- On first sign-in, if the account has no cloud data, legacy browser data is migrated once and then removed from local storage. Existing cloud data takes precedence.
- Subsequent changes sync to Firestore. Settings → Export backup remains available.
- Signing out clears account data from the active app session; it does not delete the cloud account.

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

The Worker now enforces server-side AI analysis limits. The initial limits are 20 analyses per user per UTC day and 500 per user per UTC calendar month, with a maximum of 6 requests per rolling minute window and a minimum 5-second interval between requests. A submitted analysis attempt temporarily reserves quota before calling Gemini. If Gemini returns an error or an empty response, the daily and monthly quota is refunded; request-throttling counters remain consumed to prevent repeated retries from bypassing rate limits. The usage counters are keyed by the authenticated Firebase UID; they are not client-editable.

Create a D1 database and apply the migration:

```bash
npx wrangler d1 create nutritrack-ai-usage
```

The create command prints a database ID. Put that exact ID in `wrangler.jsonc` under `d1_databases[0].database_id`, replacing `REPLACE_WITH_D1_DATABASE_ID`. Keep the binding name as `DB` and the migration directory as `migrations`. The database ID is an identifier, not a secret. Commit the real ID in the Wrangler config. Then apply the migration:

```bash
npx wrangler d1 migrations apply nutritrack-ai-usage --remote
```

Allow Cloudflare to deploy the Preview again after the config and migration are ready.

The app calls the authenticated `POST /api/usage` endpoint to display daily and monthly usage. If the D1 binding is missing or the migration has not been applied, meal analysis fails closed with a service-unavailable response; it will not bypass the quota controls.

To inspect the database:

```bash
npx wrangler d1 execute nutritrack-ai-usage --remote --command "SELECT * FROM ai_usage"
```

The daily and monthly limits are constants in `src/worker.js` (`DAILY_LIMIT` and `MONTHLY_LIMIT`). Change them only on the server. These controls are a first protective layer, not a complete paid-subscription or enterprise abuse-prevention system. Subscription entitlement checks, payment verification, Firebase token-revocation checks, and broader abuse monitoring remain launch requirements.


## 8. Account-first access and five-analysis demo

The app now requires Firebase authentication before any workspace content is displayed. There is no guest/local-only mode. Firestore is the source of truth. Existing nt_profile, nt_meals and nt_weights values are migrated once at first sign-in only when the account has no cloud profile; those legacy keys are removed after a successful upload.

The Worker creates a D1 entitlement row for each authenticated user. New accounts start in demo state and receive five lifetime demo analyses. Demo usage is separate from the paid/trial quota counters, enforced server-side, and unsuccessful Gemini calls refund the demo count. The demo endpoint is rate-limited. When demo analyses are exhausted, standard AI analysis returns a subscription-required response.

The entitlement states are demo, trialing, active, past_due, cancelled and expired. The normal 20/day and 500/month quota is available only to a valid trialing or active entitlement. Trial and paid entitlements are not activated from the browser.

Apply the new migration after the existing AI usage migration:

```bash
npx wrangler d1 migrations apply nutritrack-ai-usage --remote
```

The migration creates user_entitlements, demo_usage, payment_methods, trial_claims and subscription_events. Preview and Production currently point to the same configured D1 database in this branch; create a separate Preview database before broader testing or launch.

## 9. Razorpay integration status

Razorpay payment activation is deliberately not enabled in this foundation commit. Before enabling it, configure Razorpay Test Mode credentials as Cloudflare Worker Secrets, create monthly and annual plans, and configure a signed webhook endpoint. The Worker must create subscriptions server-side, use a future start_at for the three-day trial, and only grant access after verified Razorpay webhook events.

Razorpay webhook subscription payloads can include a provider card_id (for example, in subscription.authenticated). The duplicate-trial check should use a stable provider-issued payment-method identifier when supplied; never use last-four digits as a unique card identity and never collect raw card number or CVV. If the provider does not return a stable identifier for a payment method, do not claim duplicate-card blocking is guaranteed.

Trial eligibility policy: one successful three-day trial per recognized payment method. A previously used method cannot claim another trial, but can still purchase a paid subscription. A declined/abandoned authorization does not consume a trial. The trial must disclose the first charge amount/date and obtain explicit consent to the recurring mandate.
