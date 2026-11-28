import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];
export const firebaseConfigured = required.every((key) => Boolean(import.meta.env[key]));

let app = null;
if (firebaseConfigured) {
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    ...(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ? { storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET } : {}),
    ...(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ? { messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID } : {}),
  };
  app = getApps().length ? getApps()[0] : initializeApp(config);
}

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const functions = app ? getFunctions(app, 'asia-south1') : null;
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
