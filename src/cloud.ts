import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, type User,
} from 'firebase/auth';
import {
  getFirestore, doc, setDoc, deleteDoc, getDoc, collection, getDocs, writeBatch,
  getDocsFromServer, getDocFromServer,
  type Firestore, type DocumentReference, type WriteBatch,
} from 'firebase/firestore';
import { firebaseConfig, isFirebaseConfigured } from './firebase-config';
import type { AppSettings, Card, Deck } from './model';

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
// Cards live in their own subcollection (see below), one document per deck
// keeps every deck's size bounded no matter how many cards it holds — a
// single JSON blob for a few-thousand-card deck can exceed Firestore's 1MB
// per-document limit and fail to sync without any visible error.
export type CloudDeck = Omit<Deck, 'packageId' | 'cards'>;
export type RestoredDeck = CloudDeck & { cards: Card[] };
const toCloudDeck = ({ packageId: _packageId, cards: _cards, ...rest }: Deck): CloudDeck => rest;

const BATCH_LIMIT = 450; // stay comfortably under Firestore's 500-write cap per batch

/** Applies queued writes across as many batches as needed. */
async function commitInChunks(db: Firestore, operations: Array<(batch: WriteBatch) => void>) {
  for (let offset = 0; offset < operations.length; offset += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const op of operations.slice(offset, offset + BATCH_LIMIT)) op(batch);
    await batch.commit();
  }
}

async function deleteDeckDoc(db: Firestore, deckRef: DocumentReference) {
  const cardsSnapshot = await getDocs(collection(deckRef, 'cards'));
  const operations: Array<(batch: WriteBatch) => void> = cardsSnapshot.docs.map(cardDoc => batch => batch.delete(cardDoc.ref));
  operations.push(batch => batch.delete(deckRef));
  await commitInChunks(db, operations);
}

export async function pushDeck(uid: string, deck: Deck) {
  const firebaseApp = ensureApp();
  if (!firebaseApp) return;
  const db = getFirestore(firebaseApp);
  const deckRef = doc(db, 'users', uid, 'decks', deck.id);
  const operations: Array<(batch: WriteBatch) => void> = [batch => batch.set(deckRef, toCloudDeck(deck))];
  for (const card of deck.cards) {
    const cardRef = doc(deckRef, 'cards', card.id);
    operations.push(batch => batch.set(cardRef, { front: card.front, back: card.back }));
  }
  await commitInChunks(db, operations);
}

export async function pushAllDecks(uid: string, decks: Deck[]) {
  if (!ensureApp() || !decks.length) return;
  for (const deck of decks) await pushDeck(uid, deck);
}

export async function removeDeckFromCloud(uid: string, deckId: string) {
  const firebaseApp = ensureApp();
  if (!firebaseApp) return;
  const db = getFirestore(firebaseApp);
  await deleteDeckDoc(db, doc(db, 'users', uid, 'decks', deckId));
}

export async function clearAllCloudDecks(uid: string) {
  const firebaseApp = ensureApp();
  if (!firebaseApp) return;
  const db = getFirestore(firebaseApp);
  const snapshot = await getDocs(collection(db, 'users', uid, 'decks'));
  for (const deckDoc of snapshot.docs) await deleteDeckDoc(db, deckDoc.ref);
}

export async function pushSettings(uid: string, settings: AppSettings) {
  const firebaseApp = ensureApp();
  if (!firebaseApp) return;
  await setDoc(doc(getFirestore(firebaseApp), 'users', uid, 'meta', 'settings'), settings);
}

/** Reads this user's saved cloud content, not local decks or billing metrics. */
export async function cloudStorageUsage(uid: string) {
  const firebaseApp = ensureApp();
  if (!firebaseApp) throw new Error('Cloud backup is not configured.');
  const db = getFirestore(firebaseApp);
  const decks = await getDocsFromServer(collection(db, 'users', uid, 'decks'));
  const encoder = new TextEncoder();
  const size = (data: unknown) => encoder.encode(JSON.stringify(data)).byteLength;
  let bytes = 0, cards = 0;
  // Sequential deck reads avoid a burst of queries for large libraries.
  for (const deck of decks.docs) {
    bytes += size(deck.data());
    const savedCards = await getDocsFromServer(collection(deck.ref, 'cards'));
    for (const card of savedCards.docs) { bytes += size(card.data()); cards++; }
  }
  const settings = await getDocFromServer(doc(db, 'users', uid, 'meta', 'settings'));
  if (settings.exists()) bytes += size(settings.data());
  return { bytes, decks: decks.size, cards, checkedAt: Date.now() };
}

export async function pullAll(uid: string): Promise<{ decks: RestoredDeck[]; settings: AppSettings | undefined }> {
  const firebaseApp = ensureApp();
  if (!firebaseApp) return { decks: [], settings: undefined };
  const db = getFirestore(firebaseApp);
  const snapshot = await getDocs(collection(db, 'users', uid, 'decks'));
  const decks = await Promise.all(snapshot.docs.map(async deckDoc => {
    const cardsSnapshot = await getDocs(collection(deckDoc.ref, 'cards'));
    const cards = cardsSnapshot.docs.map(cardDoc => ({ id: cardDoc.id, ...(cardDoc.data() as { front: string; back: string }) }));
    return { ...(deckDoc.data() as CloudDeck), cards };
  }));
  const settingsSnap = await getDoc(doc(db, 'users', uid, 'meta', 'settings'));
  return { decks, settings: settingsSnap.exists() ? (settingsSnap.data() as AppSettings) : undefined };
}
