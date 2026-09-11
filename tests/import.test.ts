import { describe, expect, it } from 'vitest';
import { fixture, sql } from './fixture';
import { parseApkg } from '../src/import/apkg';
import { renderNote, type NoteType } from '../src/import/templates';

describe('APKG import', () => {
  for (const modern of [false, true]) it(`reads ${modern ? 'zstd/protobuf modern' : 'legacy JSON'} packages, reversed cards, cloze and media`, async () => {
    const result = await parseApkg(await fixture(modern), 'deck.apkg', await sql);
    expect(result.decks.map(d => d.name)).toEqual(['Imported Basics', 'Science::Cells']);
    expect(result.decks.map(d => d.cards.length)).toEqual([2, 2]);
    expect(result.decks[0].cards[0].front).toBe('Capital of France?');
    expect(result.decks[0].cards[0].back).toContain('Paris');
    expect(result.decks[0].cards[0].back).not.toContain('Capital');
    expect(result.decks[0].cards[1].front).toContain('Paris');
    expect(result.decks[1].cards[0].front).toContain('[organelle]');
    expect(result.decks[1].cards[0].front).not.toContain('nucleus');
    expect(result.decks[1].cards[0].back).toContain('nucleus');
    expect(result.decks[1].cards[1].front).toContain('nucleus');
    expect(result.decks[1].cards[1].front).not.toContain('DNA');
    expect(result.media[0].name).toBe('pixel.png');
    expect(result.media[0].mime).toBe('image/png');
    expect(result.media[0].data.byteLength).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });
  it('rejects empty, corrupt and wrong-extension files', async () => {
    await expect(parseApkg(await fixture(false, { empty: true }), 'empty.apkg', await sql)).rejects.toThrow('no cards');
    await expect(parseApkg(new Uint8Array([1, 2, 3]), 'broken.apkg', await sql)).rejects.toThrow();
    await expect(parseApkg(await fixture(), 'deck.zip', await sql)).rejects.toThrow('.apkg');
  });
  it('reports unsupported cards instead of rendering incorrect answers', async () => {
    const result = await parseApkg(await fixture(false, { unsupported: true }), 'partial.apkg', await sql);
    expect(result.decks).toHaveLength(1);
    expect(result.warnings[0]).toContain('2 cards skipped');
  });
  it('assigns stable package IDs to prevent exact duplicate imports', async () => {
    const data = await fixture();
    const a = await parseApkg(data, 'one.apkg', await sql), b = await parseApkg(data, 'renamed.apkg', await sql);
    expect(a.packageId).toBe(b.packageId);
  });
});

it('resolves nested conditional template fields', () => {
  const model: NoteType = { name: 'Basic', kind: 0, fields: ['Q', 'A'], templates: [{ ordinal: 0, front: '{{#Q}}{{#A}}{{Q}}{{/A}}{{/Q}}', back: '{{^Q}}empty{{/Q}}{{A}}' }] };
  expect(renderNote(model, ['Question', 'Answer'], 0, 'Deck')).toEqual({ front: 'Question', back: 'Answer' });
});
