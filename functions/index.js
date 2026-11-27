import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';

initializeApp();
const workerInternalSecret = defineSecret('WORKER_INTERNAL_SECRET');
const workerUrl = defineString('NUTRITRACK_WORKER_URL');

export const revokeMySessions = onCall({
  region: 'asia-south1',
  secrets: [workerInternalSecret],
  maxInstances: 5,
}, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Please sign in before revoking sessions.');
  const authTime = Number(request.auth.token.auth_time || 0);
  if (!authTime || Math.floor(Date.now() / 1000) - authTime > 5 * 60) {
    throw new HttpsError('failed-precondition', 'Please verify your Google account again, then retry.');
  }

  const uid = request.auth.uid;
  try {
    const auth = getAuth();
    await auth.revokeRefreshTokens(uid);
    const userRecord = await auth.getUser(uid);
    const revokedAfter = Math.floor(Date.parse(userRecord.tokensValidAfterTime) / 1000);
    if (!Number.isSafeInteger(revokedAfter) || revokedAfter <= 0) throw new Error('Invalid Firebase revocation timestamp.');

    await getFirestore().doc(`users/${uid}/private/session`).set({
      revokedAfter,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const baseUrl = workerUrl.value().replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/api/internal/session-revoked`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': workerInternalSecret.value() },
      body: JSON.stringify({ uid, revokedAfter }),
    });
    if (!response.ok) throw new Error(`Worker security cutoff update failed (HTTP ${response.status}).`);
    return { ok: true };
  } catch (error) {
    console.error('Session revocation failed', { uid, message: error.message });
    throw new HttpsError('unavailable', 'Firebase may have revoked refresh tokens, but all app security checks could not be updated. Retry or contact support.');
  }
});
