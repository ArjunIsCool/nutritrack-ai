import {
  collection, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp, setDoc, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';

const profileDoc = (uid) => doc(db, 'users', uid, 'private', 'profile');
const mealsCollection = (uid) => collection(db, 'users', uid, 'meals');
const writeQueues = new Map();

function queueWrite(uid, operation) {
  const previous = writeQueues.get(uid) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  writeQueues.set(uid, next);
  return next.finally(() => { if (writeQueues.get(uid) === next) writeQueues.delete(uid); });
}

export function subscribeCloudData(uid, onData, onError) {
  let profileSnapshot = null;
  let mealsSnapshot = null;
  let profileReady = false;
  let mealsReady = false;
  let published = false;
  const publish = (changed) => {
    if (!profileReady || !mealsReady) return;
    const profileData = profileSnapshot?.exists() ? profileSnapshot.data() : {};
    const changeType = published ? changed : 'initial';
    published = true;
    onData({
      profile: profileData.profile || null,
      weights: Array.isArray(profileData.weights) ? profileData.weights : null,
      meals: mealsSnapshot.docs.map((item) => item.data()),
      hasCloudData: Boolean(profileSnapshot?.exists() || !mealsSnapshot.empty),
    }, changeType);
  };
  const stopProfile = onSnapshot(profileDoc(uid), (snapshot) => {
    profileSnapshot = snapshot; profileReady = true; publish('profile');
  }, onError);
  const stopMeals = onSnapshot(mealsCollection(uid), (snapshot) => {
    mealsSnapshot = snapshot; mealsReady = true; publish('meals');
  }, onError);
  return () => { stopProfile(); stopMeals(); };
}

// Regular sync only upserts. A stale device must not erase meals created elsewhere.
export function saveCloudData(uid, data) {
  return queueWrite(uid, async () => {
  const { profile, weights, meals } = data;
  await setDoc(profileDoc(uid), { profile, weights, updatedAt: serverTimestamp() }, { merge: true });
  const operations = meals.map((meal) => ({ ref: doc(mealsCollection(uid), String(meal.id)), data: meal }));
  for (let index = 0; index < operations.length; index += 450) {
    const batch = writeBatch(db);
    operations.slice(index, index + 450).forEach((operation) => batch.set(operation.ref, operation.data));
    await batch.commit();
  }
  });
}

export function deleteCloudMeal(uid, mealId) {
  return queueWrite(uid, () => deleteDoc(doc(mealsCollection(uid), String(mealId))));
}

// Backup import intentionally replaces the remote meal collection.
export function replaceCloudData(uid, data) {
  return queueWrite(uid, async () => {
  const { profile, weights, meals } = data;
  await setDoc(profileDoc(uid), { profile, weights, updatedAt: serverTimestamp() }, { merge: true });
  const existing = await getDocs(mealsCollection(uid));
  const localIds = new Set(meals.map((meal) => String(meal.id)));
  const operations = [
    ...existing.docs.filter((item) => !localIds.has(item.id)).map((item) => ({ kind: 'delete', ref: item.ref })),
    ...meals.map((meal) => ({ kind: 'set', ref: doc(mealsCollection(uid), String(meal.id)), data: meal })),
  ];
  for (let index = 0; index < operations.length; index += 450) {
    const batch = writeBatch(db);
    operations.slice(index, index + 450).forEach((operation) => {
      if (operation.kind === 'delete') batch.delete(operation.ref);
      else batch.set(operation.ref, operation.data);
    });
    await batch.commit();
  }
  });
}

export function deleteCloudData(uid) {
  return queueWrite(uid, async () => {
  const existing = await getDocs(mealsCollection(uid));
  for (let index = 0; index < existing.docs.length; index += 450) {
    const batch = writeBatch(db);
    existing.docs.slice(index, index + 450).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  await deleteDoc(profileDoc(uid));
  });
}
