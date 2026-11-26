# NutriTrack AI

A mobile-first, installable Progressive Web App for personal calorie and nutrition tracking. It uses Gemini for meal estimates and stores profile, meals and weight history in the browser.

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

Open the local URL printed by Vite. On first launch, complete the quick profile setup, then open **Settings** to paste your Gemini API key and test the connection.

## Build

```bash
npm run build
npm run preview
```

Deploy the contents of `dist/` to any static host that supports HTTPS (for example, GitHub Pages with the correct base path, Netlify, or Cloudflare Pages). The app registers a basic service worker and includes a web app manifest.

## Important security and data notes
- This is a client-only personal app. The Gemini API key is saved in browser local storage and is accessible to anyone who can inspect that browser profile. Do not use this architecture for a public multi-user product or a key with sensitive permissions. For a public release, move Gemini requests behind a server-side proxy and keep the key in server environment variables.
- Meal prompts are sent to Google's Gemini API when you request analysis. Saved meals and profile data remain in this browser unless you export them.
- Use **Settings → Export backup** to download a JSON backup. Importing a backup replaces the current profile, meal history and weight history.
- Clearing browser data, using a different browser or changing devices can make local records unavailable. Keep backups.
- Gemini nutrition values are estimates, not laboratory measurements or medical advice. Review portions and meal assumptions before saving.
- The initial model is Gemini 3.8 Flash, with Gemini 3.5 Flash-Lite and Gemini 2.5 Flash also listed as alternatives. Model availability and free-tier eligibility can vary by account and region; choose a currently supported model in Settings if a request is rejected.

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
