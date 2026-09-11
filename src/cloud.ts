import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, type User,
} from 'firebase/auth';
import { getFirestore, doc, setDoc, deleteDoc, getDoc, collection, getDocs, writeBatch } from 'firebase/firestore';
import { firebaseConfig, isFirebaseConfigured } from './firebase-config';
import type { AppSettings, Deck } from './model';

export type { User };

let app: FirebaseApp | undefined;
function ensureApp() {
  if (!isFirebaseConfigured()) return undefined;
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

export function cloudAvailable() {
  return isFirebaseConfigured();
}

/** Fires immediately with the current user (or null), then again on every sign-in/out. */
export function onAuthChange(callback: (user: User | null) => void) {
  const firebaseApp = ensureApp();
  if (!firebaseApp) { callback(null); return () => {}; }
  return onAuthStateChanged(getAuth(firebaseApp), callback);
}

export async function signUp(email: string, password: string) {
  const firebaseApp = ensureApp();
  if (!firebaseApp) throw new Error('Cloud backup isn’t set up yet.');
  await createUserWithEmailAndPassword(getAuth(firebaseApp), email, password);
}

export async function signIn(email: string, password: string) {
  const firebaseApp = ensureApp();
  if (!firebaseApp) throw new Error('Cloud backup isn’t set up yet.');
  await signInWithEmailAndPassword(getAuth(firebaseApp), email, password);
}

export async function signOutUser() {
  const firebaseApp = ensureApp();
  if (!firebaseApp) return;
  await signOut(getAuth(firebaseApp));
}

// Bundled media never leaves the device; only the study-relevant fields sync.
export type CloudDeck = Omit<Deck, 'packageId'>;
const toCloudDeck = ({ packageId: _packageId, ...rest }: Deck): CloudDeck => rest;

export async function pushDeck(uid: string, deck: Deck) {
  const firebaseApp = ensureApp();
  if (!firebaseApp) return;
  await setDoc(doc(getFirestore(firebaseApp), 'users', uid, 'decks', deck.id), toCloudDeck(deck));
}

export async function pushAllDecks(uid: string, decks: Deck[]) {
  const firebaseApp = ensureApp();
  if (!firebaseApp || !decks.length) return;
  const db = getFirestore(firebaseApp);
  const batch = writeBatch(db);
  for (const deck of decks) batch.set(doc(db, 'users', uid, 'decks', deck.id), toCloudDeck(deck));
  await batch.commit();
}

export async function removeDeckFromCloud(uid: string, deckId: string) {
  const firebaseApp = ensureApp();
  if (!firebaseApp) return;
  await deleteDoc(doc(getFirestore(firebaseApp), 'users', uid, 'decks', deckId));
}

export async function clearAllCloudDecks(uid: string) {
  const firebaseApp = ensureApp();
  if (!firebaseApp) return;
  const db = getFirestore(firebaseApp);
  const snapshot = await getDocs(collection(db, 'users', uid, 'decks'));
  if (!snapshot.docs.length) return;
  const batch = writeBatch(db);
  for (const docSnap of snapshot.docs) batch.delete(docSnap.ref);
  await batch.commit();
}

export async function pushSettings(uid: string, settings: AppSettings) {
  const firebaseApp = ensureApp();
  if (!firebaseApp) return;
  await setDoc(doc(getFirestore(firebaseApp), 'users', uid, 'meta', 'settings'), settings);
}

export async function pullAll(uid: string): Promise<{ decks: CloudDeck[]; settings: AppSettings | undefined }> {
  const firebaseApp = ensureApp();
  if (!firebaseApp) return { decks: [], settings: undefined };
  const db = getFirestore(firebaseApp);
  const snapshot = await getDocs(collection(db, 'users', uid, 'decks'));
  const decks = snapshot.docs.map(docSnap => docSnap.data() as CloudDeck);
  const settingsSnap = await getDoc(doc(db, 'users', uid, 'meta', 'settings'));
  return { decks, settings: settingsSnap.exists() ? (settingsSnap.data() as AppSettings) : undefined };
}
