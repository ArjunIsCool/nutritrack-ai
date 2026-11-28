# NutriTrack AI

A mobile-first, installable Progressive Web App for personal calorie and nutrition tracking. It uses a Cloudflare Worker to authenticate and proxy Gemini meal-analysis requests, with mandatory Firebase Authentication and Firestore-backed account data.

## Requirements
- Node.js 22.12 or newer (required by the current Wrangler toolchain)
- A Gemini API key from https://aistudio.google.com/apikey

## Account access and cloud data

A Google account is required to access the app. Profile, meals and weight history are stored in Firestore; local-only mode is disabled. Existing browser data is migrated to the account once on first sign-in when no cloud profile exists.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. On first launch, complete the quick profile setup. Managed AI requests require a deployed Cloudflare Worker with Firebase, Gemini and D1 bindings configured.

## Build

```bash
npm run build
npm run preview
```

Build with `npm run build`. The Cloudflare Workers deployment is configured in `wrangler.jsonc` and serves the Vite `dist/` assets alongside the authenticated `/api/*` Worker routes. The app registers a basic service worker and includes a web app manifest.

## Important security and data notes
- Gemini requests are sent through the Cloudflare Worker. Configure `GEMINI_API_KEY` as a Worker Secret and `FIREBASE_PROJECT_ID` as a Worker variable; never put server secrets in `VITE_*` variables.
- The Worker verifies Firebase ID tokens, provides five lifetime demo analyses to accounts without premium access, and enforces 20 analyses per user per UTC day and 500 per UTC month for active trial/subscription entitlements. Demo usage and subscription access are enforced in D1.
- Razorpay Test Mode subscription checkout is implemented on the feature branch. Trial access still depends on the separately configured signed webhook secret and verified card authorization event; complete end-to-end tests before enabling Live payments.
- Meal prompts are forwarded to Google's Gemini API when you request analysis. Saved profile and nutrition history are stored in your authenticated Firestore account.
- Use **Settings → Export backup** to download a JSON backup. Importing a backup replaces the current profile, meal history and weight history.
- Clearing browser data, using a different browser or changing devices can make local records unavailable. Keep backups.
- Gemini nutrition values are estimates, not laboratory measurements or medical advice. Review portions and meal assumptions before saving.
- Available Gemini model IDs are selected in Settings. Model availability and quotas can change; verify the configured model against Google's current Gemini API model list.

## Features
- First-run profile setup and configurable calorie goals
- Mifflin-St Jeor BMR estimate and activity-adjusted TDEE
- Weight loss, maintenance and gain goal modes
- Editable profile and weekly rate settings
- Country-aware Gemini text and photo meal analysis with a versioned, comprehensive nutrient estimate schema
- Up to five compressed photos per analysis, with previews and server-side validation
- Itemized saved analysis snapshots with nutrient provenance and a complete meal detail view
- Meal history, daily totals and macro tracking
- Seven-day calorie chart
- Weight check-ins
- Manual JSON export/import
- Responsive dark UI and PWA install support

## Current limitations
- Barcode logging is not included yet; it is planned for Phase 4. Original meal photos are processed for analysis and are not retained in saved meal records.
- The service worker caches the app shell and previously visited static assets; Gemini analysis requires an internet connection.
- The first profile setup uses editable starter values (age 21, 175 cm, 70 kg, target 65 kg) as convenience defaults. Confirm or change them before relying on the calculated target.
- The calculator applies a conservative minimum calorie floor of 1,500 kcal/day for this initial male-profile implementation. It is a guardrail, not a personalized clinical recommendation.
