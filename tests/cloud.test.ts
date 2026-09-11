import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firestore is mocked so these tests never touch the network or a real
// project; they only verify the write-chunking behavior that keeps large
// decks from exceeding Firestore's per-document and per-batch limits.
const commits: { sets: number; deletes: number }[] = [];
const setCalls: { path: string; data: Record<string, unknown> }[] = [];

vi.mock('../src/firebase-config', () => ({
  firebaseConfig: { apiKey: 'test', projectId: 'test' },
  isFirebaseConfigured: () => true,
}));

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', () => {
  const doc = (...segments: unknown[]) => ({ path: segments.join('/') });
  return {
    getFirestore: vi.fn(() => ({})),
    getDocsFromServer: vi.fn(),
    getDocFromServer: vi.fn(),
    doc: vi.fn(doc),
    collection: vi.fn((...segments: unknown[]) => ({ path: segments.join('/') })),
    setDoc: vi.fn(),
    deleteDoc: vi.fn(),
    getDoc: vi.fn(async () => ({ exists: () => false })),
    getDocs: vi.fn(async () => ({ docs: [] as unknown[] })),
    writeBatch: vi.fn(() => {
      const batch = {
        sets: 0, deletes: 0,
        set: vi.fn(function (this: typeof batch, ref: { path: string }, data: Record<string, unknown>) { this.sets++; setCalls.push({ path: ref.path, data }); }),
        delete: vi.fn(function (this: typeof batch) { this.deletes++; }),
        commit: vi.fn(async function (this: typeof batch) { commits.push({ sets: this.sets, deletes: this.deletes }); }),
      };
      return batch;
    }),
  };
});

const { pushDeck, pushSettings, pullAll, cloudStorageUsage } = await import('../src/cloud');
const { setDoc, getDoc, getDocsFromServer, getDocFromServer } = await import('firebase/firestore');

it('measures saved server content and does not report zero on connection failure', async () => {
  const deck = { name: 'Cloud deck' };
  const card = { front: 'über', back: 'over' };
  const settings = { theme: 'paper' };
  vi.mocked(getDocsFromServer).mockResolvedValueOnce({ size: 1, docs: [{ ref: 'deck-ref', data: () => deck }] } as never);
  vi.mocked(getDocsFromServer).mockResolvedValueOnce({ size: 1, docs: [{ data: () => card }] } as never);
  vi.mocked(getDocFromServer).mockResolvedValueOnce({ exists: () => true, data: () => settings } as never);
  const usage = await cloudStorageUsage('uid');
  expect(usage.cards).toBe(1);
  expect(usage.decks).toBe(1);
  expect(usage.bytes).toBe([deck, card, settings].reduce((sum, item) => sum + new TextEncoder().encode(JSON.stringify(item)).byteLength, 0));
  vi.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('offline'));
  await expect(cloudStorageUsage('uid')).rejects.toThrow('offline');
});

it('backs up and restores all appearance and voice preferences', async () => {
  const settings = { theme: 'midnight' as const, background: 'orbits' as const, backgroundIntensity: 0.4, backgroundMotion: false, voiceURI: 'german-premium', speechRate: 0.8, preferRecordedAudio: true };
  await pushSettings('uid', settings);
  expect(setDoc).toHaveBeenLastCalledWith(expect.anything(), settings);
  vi.mocked(getDoc).mockResolvedValueOnce({ exists: () => true, data: () => settings } as never);
  expect((await pullAll('uid')).settings).toEqual(settings);
});

function makeDeck(cardCount: number) {
  const cards = Array.from({ length: cardCount }, (_, i) => ({ id: `card-${i}`, front: 'x', back: 'y' }));
  return { id: 'deck-1', name: 'Test deck', cards, reviewed: [], importedAt: 0 };
}

describe('cloud sync write chunking', () => {
  beforeEach(() => { commits.length = 0; setCalls.length = 0; });

  it('splits a large deck across multiple batches to respect the 500-write cap', async () => {
    // 1000 cards + 1 metadata write = 1001 operations, chunked at 450 per batch.
    await pushDeck('uid', makeDeck(1000));
    expect(commits.length).toBe(3);
    expect(commits.reduce((total, batch) => total + batch.sets, 0)).toBe(1001);
    for (const batch of commits) expect(batch.sets).toBeLessThanOrEqual(450);
  });

  it('keeps a small deck to a single batch', async () => {
    await pushDeck('uid', makeDeck(2));
    expect(commits.length).toBe(1);
    expect(commits[0].sets).toBe(3); // 1 metadata write + 2 cards
  });

  it('syncs schedule/difficult/tags/example, and never sends undefined fields', async () => {
    const deck = makeDeck(0);
    deck.cards = [
      { id: 'plain', front: 'a', back: 'b' },
      {
        id: 'edited', front: 'c', back: 'd', tags: ['noun'], difficult: true, example: 'ex sentence',
        schedule: { due: 1000, intervalDays: 4, reviews: 2, lapses: 0, lastReviewed: 500 },
      },
    ];
    await pushDeck('uid', deck);
    const plain = setCalls.find(call => call.path.endsWith('cards/plain'))!.data;
    expect(plain).toEqual({ front: 'a', back: 'b' });
    expect(Object.values(plain).every(value => value !== undefined)).toBe(true);
    const edited = setCalls.find(call => call.path.endsWith('cards/edited'))!.data;
    expect(edited).toEqual({
      front: 'c', back: 'd', tags: ['noun'], difficult: true, example: 'ex sentence',
      schedule: { due: 1000, intervalDays: 4, reviews: 2, lapses: 0, lastReviewed: 500 },
    });
  });
});
