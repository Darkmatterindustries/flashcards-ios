import { openDB, type DBSchema } from 'idb';
import { starterDeck, defaultSettings, type AppSettings, type Deck, type ImportResult, type MediaFile } from './model';

interface LibraryDB extends DBSchema {
  decks: { key: string; value: Deck };
  media: { key: string; value: MediaFile; indexes: { package: string } };
  settings: { key: string; value: boolean | AppSettings };
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
  return true;
}

export async function saveReviewed(deckId: string, ids: Iterable<string>) {
  const db = await database;
  const tx = db.transaction('decks', 'readwrite');
  const deck = await tx.store.get(deckId);
  if (deck) { deck.reviewed = [...new Set([...deck.reviewed, ...ids])]; await tx.store.put(deck); }
  await tx.done;
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
}

export async function mediaForDeck(deck: Deck) {
  return deck.packageId ? (await database).getAllFromIndex('media', 'package', deck.packageId) : [];
}

export async function loadSettings(): Promise<AppSettings> {
  const stored = await (await database).get('settings', 'preferences');
  return { ...defaultSettings, ...(stored as Partial<AppSettings> | undefined) };
}

export async function saveSettings(settings: AppSettings) {
  await (await database).put('settings', settings, 'preferences');
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
}

/** Deletes every deck and media file, then lets the next loadDecks() reseed the starter deck. */
export async function wipeAllDecks() {
  const db = await database;
  const tx = db.transaction(['decks', 'media', 'settings'], 'readwrite');
  await tx.objectStore('decks').clear();
  await tx.objectStore('media').clear();
  await tx.objectStore('settings').delete('seeded');
  await tx.done;
}
