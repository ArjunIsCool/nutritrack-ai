import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';

initializeApp();
const workerInternalSecret = defineSecret('WORKER_INTERNAL_SECRET');
const workerUrl = defineString('NUTRITRACK_WORKER_URL');

async function updateWorkerRevocation(baseUrl, uid, revokedAfter, secret) {
  let cleanBaseUrl = String(baseUrl || '').trim();
  while (cleanBaseUrl.endsWith('/')) cleanBaseUrl = cleanBaseUrl.slice(0, -1);
  const endpoint = `${cleanBaseUrl}/api/internal/session-revoked`;
  let lastFailure = 'Worker security update failed.';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({ uid, revokedAfter }),
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) return;
      const body = await response.text();
      lastFailure = `Worker returned HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ''}`;
      // Authentication/configuration errors will not be fixed by retrying.
      if ([400, 401, 403, 404].includes(response.status)) break;
    } catch (error) {
      lastFailure = error.name === 'TimeoutError' ? 'Worker request timed out.' : (error.message || 'Worker request failed.');
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  throw new Error(lastFailure);
}

export const revokeMySessions = onCall({
  region: 'asia-south1',
  secrets: [workerInternalSecret],
  maxInstances: 5,
}, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Please sign in before revoking sessions.');
  const uid = request.auth.uid;
  let stage = 'firebase';
  try {
    const auth = getAuth();
    await auth.revokeRefreshTokens(uid);
    const userRecord = await auth.getUser(uid);
    // auth_time has one-second precision. Move the cutoff forward one second
    // so a token minted in the same second as revocation cannot slip through.
    const revokedAfter = Math.floor(Date.parse(userRecord.tokensValidAfterTime) / 1000) + 1;
    if (!Number.isSafeInteger(revokedAfter) || revokedAfter <= 1) throw new Error('Invalid Firebase revocation timestamp.');

    stage = 'firestore';
    await getFirestore().doc(`users/${uid}/private/session`).set({
      revokedAfter,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    stage = 'worker';
    await updateWorkerRevocation(workerUrl.value(), uid, revokedAfter, workerInternalSecret.value());
    return { ok: true };
  } catch (error) {
    console.error('Session revocation failed', { uid, stage, message: error.message });
    // Expose the failed stage, not secrets or user identifiers, to make a
    // partially completed revocation diagnosable from the browser.
    throw new HttpsError(
      'unavailable',
      stage === 'worker'
        ? 'Firebase and Firestore revocation succeeded, but the Worker cutoff update failed. Check Cloud Function logs for the HTTP status and target URL.'
        : stage === 'firestore'
          ? 'Firebase refresh tokens were revoked, but writing the Firestore session cutoff failed. Check the Cloud Function service account permissions.'
          : 'Firebase session revocation failed. Check the Cloud Function logs.',
      { stage },
    );
  }
});
