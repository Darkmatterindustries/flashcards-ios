import { openDB, type DBSchema } from 'idb';
import { starterDeck, defaultSettings, type AppSettings, type BackupStatus, type Deck, type ImportResult, type MediaFile, type SessionSnapshot } from './model';
import type { Card } from './model';
import { nextSchedule, localDay, type Rating } from './review';

/** Records that local content changed, for the settings screen's "pending changes" indicator. Best-effort, not tied to the write it tracks. */
export async function markModified() {
  await (await database).put('settings', Date.now(), 'lastModified');
}

export async function getLastModified(): Promise<number> {
  return (await (await database).get('settings', 'lastModified')) as number | undefined ?? 0;
}

export async function loadBackupStatus(): Promise<BackupStatus> {
  return (await (await database).get('settings', 'backupStatus')) as BackupStatus | undefined ?? {};
}

export async function saveBackupStatus(status: BackupStatus) {
  await (await database).put('settings', status, 'backupStatus');
}

export async function editCard(deckId: string, cardId: string, changes: Pick<Card, 'front' | 'back' | 'example' | 'tags' | 'difficult'>) {
  const db = await database;
  const tx = db.transaction('decks', 'readwrite');
  const deck = await tx.store.get(deckId);
  const card = deck?.cards.find(c => c.id === cardId);
  if (!deck || !card) throw new Error('This card is no longer in the deck.');
  Object.assign(card, changes);
  await tx.store.put(deck);
  await tx.done;
  void markModified();
}

export async function recordActivity(deckId: string, delta = 1) {
  const db = await database;
  const tx = db.transaction('decks', 'readwrite');
  const deck = await tx.store.get(deckId);
  if (deck) {
    const day = localDay();
    deck.activity ??= {};
    deck.activity[day] = Math.max(0, (deck.activity[day] ?? 0) + delta);
    await tx.store.put(deck);
  }
  await tx.done;
  void markModified();
}

export async function rateCard(deckId: string, cardId: string, rating: Rating) {
  const db = await database;
  const tx = db.transaction('decks', 'readwrite');
  const deck = await tx.store.get(deckId);
  const card = deck?.cards.find(c => c.id === cardId);
  if (!deck || !card) throw new Error('This card is no longer in the deck.');
  card.schedule = nextSchedule(card.schedule, rating);
  const day = localDay();
  deck.activity ??= {};
  deck.activity[day] = (deck.activity[day] ?? 0) + 1;
  await tx.store.put(deck);
  await tx.done;
  void markModified();
  return card.schedule;
}

interface LibraryDB extends DBSchema {
  decks: { key: string; value: Deck };
  media: { key: string; value: MediaFile; indexes: { package: string } };
  settings: { key: string; value: boolean | number | AppSettings | BackupStatus };
}

const database = openDB<LibraryDB>('flashcards', 1, {
  upgrade(db) {
    db.createObjectStore('decks', { keyPath: 'id' });
    db.createObjectStore('media', { keyPath: 'id' }).createIndex('package', 'packageId');
    db.createObjectStore('settings');
  },
});

export async function loadDecks(): Promise<Deck[]> {
  const db = await database;
  const tx = db.transaction(['settings', 'decks'], 'readwrite');
  if (!await tx.objectStore('settings').get('seeded')) {
    await tx.objectStore('decks').put(starterDeck());
    await tx.objectStore('settings').put(true, 'seeded');
  }
  await tx.done;
  return (await db.getAll('decks')).sort((a, b) => a.importedAt - b.importedAt || a.name.localeCompare(b.name));
}

/** Atomic import: either every deck/media file is saved, or nothing changes. */
export async function saveImport(result: ImportResult): Promise<boolean> {
  const db = await database;
  const tx = db.transaction(['decks', 'media'], 'readwrite');
  const decks = tx.objectStore('decks');
  if (await decks.get(result.decks[0].id)) { await tx.done; return false; }
  for (const deck of result.decks) await decks.put(deck);
  for (const file of result.media) await tx.objectStore('media').put(file);
  await tx.done;
  void markModified();
  return true;
}

export async function saveReviewed(deckId: string, ids: Iterable<string>) {
  const db = await database;
  const tx = db.transaction('decks', 'readwrite');
  const deck = await tx.store.get(deckId);
  if (deck) { deck.reviewed = [...new Set([...deck.reviewed, ...ids])]; await tx.store.put(deck); }
  await tx.done;
  void markModified();
}

/** Permanently relocates a card into its deck's paired "Memorized" companion, creating it on first use. */
export async function moveToMemorized(sourceDeckId: string, cardId: string) {
  const db = await database;
  const tx = db.transaction('decks', 'readwrite');
  const store = tx.objectStore('decks');
  const source = await store.get(sourceDeckId);
  const index = source?.cards.findIndex(card => card.id === cardId) ?? -1;
  if (!source || index === -1) { await tx.done; return; }
  const [card] = source.cards.splice(index, 1);
  source.reviewed = source.reviewed.filter(id => id !== cardId);
  const companionId = `${sourceDeckId}::memorized`;
  const companion = await store.get(companionId) ?? {
    id: companionId, name: `${source.name} — Memorized`, cards: [], reviewed: [],
    importedAt: Date.now(), packageId: source.packageId, memorizedFor: sourceDeckId,
  };
  companion.cards.push(card);
  await store.put(source);
  await store.put(companion);
  await tx.done;
  void markModified();
}

export async function mediaForDeck(deck: Deck) {
  return deck.packageId ? (await database).getAllFromIndex('media', 'package', deck.packageId) : [];
}

export async function getDeck(id: string) {
  return (await database).get('decks', id);
}

/** Replaces the entire library with the given decks (used to restore a cloud backup). Media isn't part of a backup. */
export async function replaceAllDecks(decks: Deck[]) {
  const db = await database;
  const tx = db.transaction(['decks', 'settings'], 'readwrite');
  await tx.objectStore('decks').clear();
  for (const deck of decks) await tx.objectStore('decks').put(deck);
  await tx.objectStore('settings').put(true, 'seeded');
  await tx.done;
}

/** Removes a card from a deck's Memorized companion and returns it to the source deck's own list. */
export async function moveBackFromMemorized(sourceDeckId: string, cardId: string) {
  const db = await database;
  const tx = db.transaction('decks', 'readwrite');
  const store = tx.objectStore('decks');
  const companion = await store.get(`${sourceDeckId}::memorized`);
  const index = companion?.cards.findIndex(card => card.id === cardId) ?? -1;
  if (!companion || index === -1) { await tx.done; return; }
  const [card] = companion.cards.splice(index, 1);
  companion.reviewed = companion.reviewed.filter(id => id !== cardId);
  const source = await store.get(sourceDeckId);
  if (source) { source.cards.push(card); await store.put(source); }
  await store.put(companion);
  await tx.done;
  void markModified();
}

export async function unmarkReviewed(deckId: string, cardId: string) {
  const db = await database;
  const tx = db.transaction('decks', 'readwrite');
  const deck = await tx.store.get(deckId);
  if (deck) { deck.reviewed = deck.reviewed.filter(id => id !== cardId); await tx.store.put(deck); }
  await tx.done;
  void markModified();
}

/** Persists the in-progress queue so leaving and reopening this deck resumes it; pass undefined to clear it. */
export async function saveSessionState(deckId: string, snapshot: SessionSnapshot | undefined) {
  const db = await database;
  const tx = db.transaction('decks', 'readwrite');
  const deck = await tx.store.get(deckId);
  if (deck) { deck.activeSession = snapshot; await tx.store.put(deck); }
  await tx.done;
}

export async function setDeckShuffle(deckId: string, shuffle: boolean) {
  const db = await database;
  const tx = db.transaction('decks', 'readwrite');
  const deck = await tx.store.get(deckId);
  if (deck) { deck.shuffle = shuffle; await tx.store.put(deck); }
  await tx.done;
  void markModified();
}

export async function renameDeck(deckId: string, name: string) {
  const db = await database;
  const tx = db.transaction('decks', 'readwrite');
  const deck = await tx.store.get(deckId);
  if (deck) { deck.name = name; await tx.store.put(deck); }
  await tx.done;
  void markModified();
}

/** Deletes a deck, its Memorized companion (if any), and any media no other deck still references. */
export async function deleteDeck(deckId: string) {
  const db = await database;
  const tx = db.transaction(['decks', 'media'], 'readwrite');
  const decks = tx.objectStore('decks');
  const deck = await decks.get(deckId);
  await decks.delete(deckId);
  await decks.delete(`${deckId}::memorized`);
  if (deck?.packageId) {
    const stillUsed = (await decks.getAll()).some(other => other.packageId === deck.packageId);
    if (!stillUsed) {
      const media = tx.objectStore('media');
      let cursor = await media.index('package').openCursor(deck.packageId);
      while (cursor) { await cursor.delete(); cursor = await cursor.continue(); }
    }
  }
  await tx.done;
  void markModified();
}

export async function loadSettings(): Promise<AppSettings> {
  const stored = await (await database).get('settings', 'preferences');
  return { ...defaultSettings, ...(stored as Partial<AppSettings> | undefined) };
}

export async function saveSettings(settings: AppSettings) {
  await (await database).put('settings', settings, 'preferences');
}

/** Content sizes exclude database indexes/overhead; browser quota is separate. */
export async function storageSummary() {
  const db = await database;
  const tx = db.transaction(['decks', 'media', 'settings'], 'readonly');
  const decks = await tx.objectStore('decks').getAll();
  const settings = await tx.objectStore('settings').getAll();
  let mediaBytes = 0, mediaCount = 0;
  let cursor = await tx.objectStore('media').openCursor();
  while (cursor) {
    mediaBytes += cursor.value.data.byteLength;
    mediaCount++;
    cursor = await cursor.continue();
  }
  await tx.done;
  const textBytes = new TextEncoder().encode(JSON.stringify({ decks, settings })).byteLength;
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  return { decks: decks.length, cards: decks.reduce((n, deck) => n + deck.cards.length, 0), textBytes, mediaBytes, mediaCount, estimate };
}

/** Clears reviewed/memorized-progress markers on every deck; cards and decks themselves are untouched. */
export async function resetProgress() {
  const db = await database;
  const tx = db.transaction('decks', 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (cursor.value.reviewed.length) await cursor.update({ ...cursor.value, reviewed: [] });
    cursor = await cursor.continue();
  }
  await tx.done;
  void markModified();
}

/** Deletes every deck and media file, then lets the next loadDecks() reseed the starter deck. */
export async function wipeAllDecks() {
  const db = await database;
  const tx = db.transaction(['decks', 'media', 'settings'], 'readwrite');
  await tx.objectStore('decks').clear();
  await tx.objectStore('media').clear();
  await tx.objectStore('settings').delete('seeded');
  await tx.done;
  void markModified();
}
