import { readFile, writeFile } from 'node:fs/promises';
const inventory = JSON.parse(await readFile('artifacts/grammar-inventory.json', 'utf8'));
const examples = JSON.parse(await readFile('src/grammar-examples.json', 'utf8'));
const missing = inventory.entries.filter(entry => !Object.hasOwn(examples, entry.word));
const invalid = [];
for (const [word, entry] of Object.entries(examples)) {
  if (!['word', 'note', 'proTip'].every(key => typeof entry[key] === 'string' && entry[key].trim())) invalid.push(word);
  for (const key of ['nominative', 'accusative', 'dative', 'genitive']) {
    const part = entry[key];
    if (!part || !['german', 'english', 'phrase', 'hint'].every(field => typeof part[field] === 'string' && part[field].trim()) || !part.german.includes(part.phrase)) invalid.push(`${word}: ${key}`);
  }
}
const report = { totalWords: inventory.words, coveredWords: inventory.words - missing.length, totalCards: inventory.cards,
  coveredCards: inventory.entries.filter(e => Object.hasOwn(examples, e.word)).reduce((sum, e) => sum + e.cards.length, 0),
  missingWords: missing.map(e => e.word), invalid,
  note: 'Coverage and structure only; linguistic review is also required before release.' };
await writeFile('artifacts/grammar-coverage.json', JSON.stringify(report, null, 2));
console.log(`${report.coveredWords}/${report.totalWords} words; ${report.coveredCards}/${report.totalCards} cards; ${invalid.length} invalid entries.`);
const allowPartial = process.argv.includes('--progressive') || process.argv.includes('--allow-partial');
if (invalid.length || (!allowPartial && missing.length)) {
  console.error('Grammar release gate failed: ' + (invalid.length ? `${invalid.length} invalid entries found.` : 'content is incomplete.'));
  process.exitCode = 1;
} else if (allowPartial && missing.length) {
  console.log(`Progressive coverage gate passed: ${report.coveredWords}/${report.totalWords} words active with 0 invalid entries.`);
}
