# Firebase Admin setup: sign out everywhere

## What this feature does

The app uses a Firebase 2nd-generation callable Cloud Function with the Firebase Admin SDK. The Admin SDK runs only in Google's server environment; no service-account private key is stored in the browser or repository.

1. The signed-in user confirms the action; no second Google popup is shown.
2. The callable function verifies the Firebase-authenticated caller and uses that caller's UID only.
3. Firebase Admin revokes the user's refresh tokens.
4. A private Firestore session document records the revocation cutoff; Firestore rules reject tokens authenticated before that cutoff.
5. The function sends the same cutoff to the Cloudflare Worker through a shared secret. The Worker stores it in D1 and rejects older tokens on every authenticated API route.
6. The current browser signs out. Other devices must sign in again when they next access Firestore or a Worker API.

Firebase ID tokens may otherwise remain valid for up to one hour after refresh-token revocation. The Firestore and Worker cutoff checks provide immediate enforcement for this app's protected data and API routes. Offline devices cannot be remotely forced to erase already-downloaded or cached data.

## Prerequisites and billing

- Firebase project `nutritrack-ai-6337e`, Google sign-in and Firestore enabled.
- Link a billing account and upgrade Firebase to the **Blaze** plan before deploying Cloud Functions. Set a small Google Cloud budget alert. Cloud Functions, Secret Manager, build and network usage can incur charges.
- Install Node.js 22 and Firebase CLI.

## Setup

From the repository root:

```bash
npm install -g firebase-tools
firebase login
firebase use nutritrack-ai-6337e
cd functions
npm install
cd ..
```

No service-account JSON key is required. Cloud Functions uses its attached Google service identity / Application Default Credentials. In Google Cloud Console → IAM, confirm the runtime service account used by this function has the permissions needed for Firebase Authentication user management (typically **Firebase Authentication Admin** / `roles/firebaseauth.admin`) and Firestore writes (for example **Cloud Datastore User** / `roles/datastore.user`, subject to your project's IAM model). Grant only the minimum required roles to the actual runtime service account; do not grant Owner or Editor just to make deployment work.

### Configure the shared secret

Generate a long random secret using a password manager or local secure generator. Do not commit it, put it in a `VITE_*` variable, or paste it into chat.

Set it for Firebase Functions:

```bash
firebase functions:secrets:set WORKER_INTERNAL_SECRET
```

Set the **same value** as a Cloudflare Worker secret:

```bash
npx wrangler secret put SESSION_REVOCATION_SECRET
```

For preview testing, also set it in the Cloudflare Preview environment. Production and preview should use separate secrets and environments.

### Configure the Worker URL

During deployment, Firebase prompts for `NUTRITRACK_WORKER_URL`. Enter the stable HTTPS Worker URL for the matching environment, not a per-commit preview URL. For a preview test, use a separately configured preview function environment and preview Worker URL.

### Apply D1 migration

Apply `migrations/0004_session_revocations.sql` to the D1 database used by the Worker. Verify the target before confirming:

```bash
npx wrangler d1 migrations apply nutritrack-ai-usage --remote
```

Preview and production currently point at the same D1 database in this repository configuration. Isolate them before production rollout.

### Deploy

```bash
firebase deploy --only functions:revokeMySessions,firestore:rules
```

Deploy the updated Cloudflare Worker after setting its secret and applying the migration. The callable function runs in `asia-south1`.

## Two-device test

Use a dedicated test account, not your only production account.

1. Sign in to the same account on two browsers/devices.
2. On device A, open Settings → Privacy & security → **Sign out on all devices**.
3. Device A should sign out immediately after the server confirms revocation.
4. On device B, try to sync or make an authenticated API request. It should be denied and require a fresh sign-in.
5. Sign in again on device B; access should work normally.
6. Repeat with device B offline, then reconnect it. It should be required to reauthenticate before cloud access resumes.

## Recovery note

If Firebase revokes refresh tokens but the Worker cutoff update fails, the function reports an error. The Firestore cutoff has already been written, so retry the action or reconcile the Worker D1 cutoff before considering the feature healthy.
