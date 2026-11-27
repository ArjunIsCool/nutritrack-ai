import {
  collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';

const profileDoc = (uid) => doc(db, 'users', uid, 'private', 'profile');
const mealsCollection = (uid) => collection(db, 'users', uid, 'meals');

export async function loadCloudData(uid) {
  const [profileSnap, mealsSnap] = await Promise.all([
    getDoc(profileDoc(uid)),
    getDocs(mealsCollection(uid)),
  ]);
  const data = profileSnap.exists() ? profileSnap.data() : {};
  return {
    profile: data.profile || null,
    weights: Array.isArray(data.weights) ? data.weights : null,
    meals: mealsSnap.docs.map((item) => item.data()),
    hasCloudData: profileSnap.exists() || !mealsSnap.empty,
  };
}

export async function saveCloudData(uid, { profile, weights, meals }) {
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
