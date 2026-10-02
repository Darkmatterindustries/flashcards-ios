// Structural check for grammar-workspace drafts. Completeness and shape only;
// passing this script does not mean the German has been reviewed.
import { readFile, readdir } from 'node:fs/promises';

const root = 'grammar-workspace';
const LIMITS = { german: 250, english: 300, phrase: 150, hint: 600, note: 600, proTip: 500 };
const CASES = ['nominative', 'accusative', 'dative', 'genitive'];

const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
const wordById = new Map(manifest.entries.map(entry => [entry.id, entry.word]));
const files = (await readdir(`${root}/outputs`)).filter(name => name.endsWith('.md')).sort();

const problems = [];
let totalEntries = 0;
let totalIssues = 0;
const done = [];

for (const file of files) {
  const batchId = file.replace(/\.md$/, '');
  const expected = manifest.batches.find(batch => batch.batchId === batchId);
  const fail = message => problems.push(`${batchId}: ${message}`);
  if (!expected) { fail('no such batch in manifest.json'); continue; }

  const raw = await readFile(`${root}/outputs/${file}`, 'utf8');
  const blocks = [...raw.matchAll(/```json\r?\n([\s\S]*?)```/g)];
  if (blocks.length !== 1) { fail(`expected exactly one fenced json block, found ${blocks.length}`); continue; }

  let parsed;
  try { parsed = JSON.parse(blocks[0][1]); }
  catch (error) { fail(`invalid JSON: ${error.message}`); continue; }

  if (parsed.batchId !== batchId) fail(`batchId is "${parsed.batchId}", expected "${batchId}"`);
  if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.issues)) { fail('entries and issues must both be arrays'); continue; }

  const seen = new Map();
  for (const entry of [...parsed.entries, ...parsed.issues]) {
    if (typeof entry?.id !== 'string') { fail('an entry or issue has no string id'); continue; }
    if (seen.has(entry.id)) fail(`${entry.id} appears more than once`);
    seen.set(entry.id, entry);
  }
  for (const id of expected.ids) if (!seen.has(id)) fail(`${id} is missing from both entries and issues`);
  for (const id of seen.keys()) if (!expected.ids.includes(id)) fail(`${id} does not belong to this batch`);

  for (const issue of parsed.issues) {
    if (typeof issue.reason !== 'string' || !issue.reason.trim()) fail(`${issue.id}: issue needs a non-empty reason`);
  }

  for (const entry of parsed.entries) {
    const where = `${entry.id}`;
    const expectedWord = wordById.get(entry.id);
    if (expectedWord !== undefined && entry.word !== expectedWord) fail(`${where}: word is "${entry.word}", expected "${expectedWord}"`);
    for (const key of ['note', 'proTip']) {
      const value = entry[key];
      if (typeof value !== 'string' || !value.trim()) { fail(`${where}: ${key} is missing or empty`); continue; }
      if (value.length > LIMITS[key]) fail(`${where}: ${key} is ${value.length} chars, limit ${LIMITS[key]}`);
    }
    for (const grammaticalCase of CASES) {
      const part = entry[grammaticalCase];
      if (!part || typeof part !== 'object') { fail(`${where}: ${grammaticalCase} is missing`); continue; }
      let complete = true;
      for (const field of ['german', 'english', 'phrase', 'hint']) {
        const value = part[field];
        if (typeof value !== 'string' || !value.trim()) { fail(`${where}/${grammaticalCase}: ${field} is missing or empty`); complete = false; continue; }
        if (value.length > LIMITS[field]) fail(`${where}/${grammaticalCase}: ${field} is ${value.length} chars, limit ${LIMITS[field]}`);
      }
      // The case phrase must be copied verbatim out of the German sentence.
      if (complete && !part.german.includes(part.phrase)) fail(`${where}/${grammaticalCase}: phrase "${part.phrase}" does not appear in the German sentence`);
    }
  }

  totalEntries += parsed.entries.length;
  totalIssues += parsed.issues.length;
  if (!problems.some(problem => problem.startsWith(`${batchId}:`))) done.push(batchId);
}

const remaining = manifest.batches.filter(batch => !files.includes(`${batch.batchId}.md`));
console.log(`${files.length}/${manifest.batches.length} batches drafted; ${totalEntries} lessons, ${totalIssues} flagged entries.`);
console.log(`Next batch to write: ${remaining[0]?.batchId ?? 'none — all batches drafted'}`);
if (problems.length) {
  console.error(`\n${problems.length} structural problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\nStructure only. Linguistic review is still required before anything reaches src/grammar-examples.json.');
  process.exitCode = 1;
} else {
  console.log('Structure OK. This is not a linguistic review — the German still needs checking by a reviewer.');
}
