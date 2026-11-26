# NutriTrack AI

A mobile-first, installable Progressive Web App for personal calorie and nutrition tracking. It uses a Cloudflare Worker to authenticate and proxy Gemini meal-analysis requests, with Firebase Authentication and Firestore for optional account sync.

## Requirements
- Node.js 18 or newer
- A Gemini API key from https://aistudio.google.com/apikey

## Firebase cloud sync

Google sign-in and cross-device cloud synchronization are optional until Firebase is configured. Follow [docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md) and use [`.env.example`](.env.example). Without Firebase settings, the app continues to work in local-only mode.

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
- The Worker verifies Firebase ID tokens and enforces an initial allowance of 10 AI analyses per user per UTC day and 100 per UTC month, plus request throttling. These controls require the Cloudflare D1 binding and migration described in [docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md).
- Subscription entitlements, payment verification, Firebase token-revocation checks and broader abuse monitoring are not implemented. Do not launch paid access until these controls are added.
- Meal prompts are forwarded to Google's Gemini API when you request analysis. Saved meals and profile data remain in this browser unless you sign in and enable cloud sync.
- Use **Settings → Export backup** to download a JSON backup. Importing a backup replaces the current profile, meal history and weight history.
- Clearing browser data, using a different browser or changing devices can make local records unavailable. Keep backups.
- Gemini nutrition values are estimates, not laboratory measurements or medical advice. Review portions and meal assumptions before saving.
- Available Gemini model IDs are selected in Settings. Model availability and quotas can change; verify the configured model against Google's current Gemini API model list.

## Features
- First-run profile setup and configurable calorie goals
- Mifflin-St Jeor BMR estimate and activity-adjusted TDEE
- Weight loss, maintenance and gain goal modes
- Editable profile and weekly rate settings
- Gemini-powered natural-language meal analysis with itemized estimates
- Meal history, daily totals and macro tracking
- Seven-day calorie chart
- Weight check-ins
- Manual JSON export/import
- Responsive dark UI and PWA install support

## Current limitations
- Text-based food logging only; photo and voice logging are not included in this initial build.
- The service worker caches the app shell and previously visited static assets; Gemini analysis requires an internet connection.
- The first profile setup uses editable starter values (age 21, 175 cm, 70 kg, target 65 kg) as convenience defaults. Confirm or change them before relying on the calculated target.
- The calculator applies a conservative minimum calorie floor of 1,500 kcal/day for this initial male-profile implementation. It is a guardrail, not a personalized clinical recommendation.
