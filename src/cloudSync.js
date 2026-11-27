import {
  collection, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp, setDoc, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';

const profileDoc = (uid) => doc(db, 'users', uid, 'private', 'profile');
const mealsCollection = (uid) => collection(db, 'users', uid, 'meals');

export function subscribeCloudData(uid, onData, onError) {
  let profileSnapshot = null;
  let mealsSnapshot = null;
  let profileReady = false;
  let mealsReady = false;
  const publish = () => {
    if (!profileReady || !mealsReady) return;
    const profileData = profileSnapshot?.exists() ? profileSnapshot.data() : {};
    onData({
      profile: profileData.profile || null,
      weights: Array.isArray(profileData.weights) ? profileData.weights : null,
      meals: mealsSnapshot.docs.map((item) => item.data()),
      hasCloudData: Boolean(profileSnapshot?.exists() || !mealsSnapshot.empty),
    });
  };
  const stopProfile = onSnapshot(profileDoc(uid), (snapshot) => {
    profileSnapshot = snapshot; profileReady = true; publish();
  }, onError);
  const stopMeals = onSnapshot(mealsCollection(uid), (snapshot) => {
    mealsSnapshot = snapshot; mealsReady = true; publish();
  }, onError);
  return () => { stopProfile(); stopMeals(); };
}

// Regular sync only upserts. A stale device must not erase meals created elsewhere.
export async function saveCloudData(uid, { profile, weights, meals }) {
  await setDoc(profileDoc(uid), { profile, weights, updatedAt: serverTimestamp() }, { merge: true });
  const operations = meals.map((meal) => ({ ref: doc(mealsCollection(uid), String(meal.id)), data: meal }));
  for (let index = 0; index < operations.length; index += 450) {
    const batch = writeBatch(db);
    operations.slice(index, index + 450).forEach((operation) => batch.set(operation.ref, operation.data));
    await batch.commit();
  }
}

export async function deleteCloudMeal(uid, mealId) {
  await deleteDoc(doc(mealsCollection(uid), String(mealId)));
}

// Backup import intentionally replaces the remote meal collection.
export async function replaceCloudData(uid, { profile, weights, meals }) {
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
}

export async function deleteCloudData(uid) {
  const existing = await getDocs(mealsCollection(uid));
  for (let index = 0; index < existing.docs.length; index += 450) {
    const batch = writeBatch(db);
    existing.docs.slice(index, index + 450).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  await deleteDoc(profileDoc(uid));
}
