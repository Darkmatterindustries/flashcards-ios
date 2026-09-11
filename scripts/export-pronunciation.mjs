import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { createServer } from 'vite';
import initSqlJs from 'sql.js';
import { JSDOM } from 'jsdom';

const files = process.argv.slice(2);
if (!files.length) throw new Error('Pass one or more .apkg files. Output: artifacts/imported-pronunciation.txt');
const dom = new JSDOM('');
globalThis.document = dom.window.document;
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { parseApkg } = await server.ssrLoadModule('/src/import/apkg.ts');
  const { plainText } = await server.ssrLoadModule('/src/speech-text.ts');
  const sql = await initSqlJs();
  const words = new Set();
  const report = [];
  for (const file of files) {
    const result = await parseApkg(new Uint8Array(await readFile(file)), basename(file), sql);
    for (const deck of result.decks) {
      for (const card of deck.cards) {
        const text = plainText(card.front);
        if (text) words.add(text);
      }
      report.push({ file: basename(file), deck: deck.name, cards: deck.cards.length });
    }
    if (result.warnings.length) console.log('Import warnings:', result.warnings);
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/imported-pronunciation.txt', [...words].join('\n') + '\n');
  await writeFile('artifacts/imported-pronunciation-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`${words.size} unique spoken fronts exported.`);
} finally { await server.close(); dom.window.close(); }
