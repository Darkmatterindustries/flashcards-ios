import { openDB, type DBSchema } from 'idb';
import { starterDeck, type Deck, type ImportResult, type MediaFile } from './model';

interface LibraryDB extends DBSchema {
  decks: { key: string; value: Deck };
  media: { key: string; value: MediaFile; indexes: { package: string } };
  settings: { key: string; value: boolean };
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

export async function mediaForDeck(deck: Deck) {
  return deck.packageId ? (await database).getAllFromIndex('media', 'package', deck.packageId) : [];
}
