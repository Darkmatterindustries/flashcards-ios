// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sql } from './fixture';
import { buildApkg, apkgFileName } from '../src/export';
import { parseApkg } from '../src/import/apkg';
import type { Deck } from '../src/model';

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1', name: 'German Vocabulary', importedAt: 0, reviewed: [],
    cards: [
      { id: 'c1', front: 'der<br>Entwurf', back: 'the draft<p class="explanation">A preliminary version.</p>' },
      { id: 'c2', front: 'die Erinnerung', back: 'the memory' },
    ],
    ...overrides,
  };
}

describe('exporting a deck back to .apkg', () => {
  it('round-trips through the app\'s own importer with the same cards', async () => {
    const deck = makeDeck();
    const blob = buildApkg(deck, await sql);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = await parseApkg(bytes, 'German Vocabulary.apkg', await sql);
    expect(result.decks).toHaveLength(1);
    expect(result.decks[0].name).toBe('German Vocabulary');
    expect(result.decks[0].cards).toHaveLength(2);
    expect(result.decks[0].cards[0].front).toContain('Entwurf');
    expect(result.decks[0].cards[0].back).toContain('draft');
    expect(result.decks[0].cards[1].front).toContain('Erinnerung');
    expect(result.warnings).toEqual([]);
  });

  it('produces a valid zip even for an empty deck', async () => {
    const deck = makeDeck({ cards: [] });
    const blob = buildApkg(deck, await sql);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('sanitizes the suggested file name', () => {
    expect(apkgFileName('Goethe C1: Vocabulary / Notes?')).toBe('Goethe C1 Vocabulary Notes.apkg');
    expect(apkgFileName('')).toBe('Deck.apkg');
  });
});
