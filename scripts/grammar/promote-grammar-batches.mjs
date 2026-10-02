import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const targetPath = 'src/grammar-examples.json';
const outputsDir = 'grammar-workspace/outputs';

const existing = existsSync(targetPath)
  ? JSON.parse(await readFile(targetPath, 'utf8'))
  : {};

const requestedBatches = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const files = (await readdir(outputsDir))
  .filter(f => f.endsWith('.md'))
  .filter(f => {
    if (requestedBatches.length === 0 || process.argv.includes('--all')) return true;
    const batchId = f.replace(/\.md$/, '');
    return requestedBatches.includes(batchId);
  })
  .sort();

if (files.length === 0) {
  console.log('No matching output batches found to promote.');
  process.exit(0);
}

let promotedWords = 0;
let updatedWords = 0;

for (const file of files) {
  const content = await readFile(`${outputsDir}/${file}`, 'utf8');
  const match = content.match(/```json\r?\n([\s\S]*?)\r?\n```/);
  if (!match) {
    console.warn(`Warning: No JSON block found in ${file}`);
    continue;
  }
  const data = JSON.parse(match[1]);
  for (const entry of data.entries) {
    const { word, note, proTip, nominative, accusative, dative, genitive } = entry;
    if (!word || !note || !proTip || !nominative || !accusative || !dative || !genitive) {
      console.warn(`Warning: Incomplete entry for "${word}" in ${file}`);
      continue;
    }
    const cleanEntry = { word, note, nominative, accusative, dative, genitive, proTip };
    if (Object.hasOwn(existing, word)) {
      updatedWords++;
    } else {
      promotedWords++;
    }
    existing[word] = cleanEntry;
  }
}

await writeFile(targetPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
const total = Object.keys(existing).length;
console.log(`Successfully promoted ${files.length} batch(es):`);
console.log(`  - New words added: ${promotedWords}`);
console.log(`  - Existing words updated: ${updatedWords}`);
console.log(`  - Total active lessons in ${targetPath}: ${total}`);
