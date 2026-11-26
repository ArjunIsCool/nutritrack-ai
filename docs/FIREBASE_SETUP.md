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
