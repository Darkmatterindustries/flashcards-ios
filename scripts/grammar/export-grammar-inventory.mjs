import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { createServer } from 'vite';
import initSqlJs from 'sql.js';
import { JSDOM } from 'jsdom';

const files = process.argv.slice(2);
if (!files.length) throw new Error('Pass the APKG files to inventory.');
const dom = new JSDOM('');
globalThis.document = dom.window.document;
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { parseApkg } = await server.ssrLoadModule('/src/import/apkg.ts');
  const { plainText } = await server.ssrLoadModule('/src/speech-text.ts');
  const { starterDeck } = await server.ssrLoadModule('/src/model.ts');
  const sql = await initSqlJs();
  const entries = new Map();
  let cards = 0;
  function collect(deck, source) {
    for (const card of deck.cards) {
      cards++;
      const word = plainText(card.front);
      const meaning = plainText(card.back);
      const entry = entries.get(word) ?? { word, meanings: [], cards: [] };
      if (!entry.meanings.includes(meaning)) entry.meanings.push(meaning);
      entry.cards.push({ source, deck: deck.name, id: card.id });
      entries.set(word, entry);
    }
  }
  collect(starterDeck(), 'starter');
  for (const file of files) {
    const result = await parseApkg(new Uint8Array(await readFile(file)), basename(file), sql);
    for (const deck of result.decks) collect(deck, basename(file));
    if (result.warnings.length) console.log(result.warnings);
  }
  await mkdir('artifacts', { recursive: true });
  const output = { cards, words: entries.size, entries: [...entries.values()] };
  await writeFile('artifacts/grammar-inventory.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ cards, words: entries.size, multipleMeanings: output.entries.filter(e => e.meanings.length > 1).length }));
} finally { await server.close(); dom.window.close(); }
