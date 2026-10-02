// Regenerates a curated version of Goethe_C1_Vocabulary.apkg. Unlike German_C1_Vocabulary,
// this deck is genuinely well-curated (verified by a full read-through of all 1,541 nouns,
// 716 adjectives and 87 idioms, plus a pattern scan + broad sample of the 1,116 verbs) — only
// a handful of individual words need removal, not a whole thematic cluster.
//
// Self-contained, same approach as build-curated-deck.mjs (bypasses Vite's SSR module runner,
// which hangs in this environment; inlines the same verbatim rendering/export logic).
import { readFile, writeFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strToU8 } from 'fflate';

const SOURCE = 'flashcarddecks/Goethe_C1_Vocabulary.apkg';
const OUTPUT = 'flashcarddecks/Goethe_C1_Vocabulary_Curated.apkg';
const NEW_DECK_NAME = 'Goethe C1 Vocabulary (Curated)';

// Two genuine narrow-jargon words (same astrophysics family as German_C1_Vocabulary's cluster).
// Two typo-duplicates of a correctly-spelled word already present elsewhere in the deck.
// Three corrupted import fragments that cannot form a usable card at all (already flagged
// separately as unresolved "issues" during the grammar-lesson drafting pass).
const CUT_WORDS = new Set([
  'diegalaxie', 'dersonnenwind', // narrow jargon
  'dermehrwehrt', 'derkompromis', // typo-duplicates (Mehrwert / Kompromiss already present)
  'dung', 'licheaufklärung', 'digitalnatives/immigrants', 'dassup', // corrupted fragments
].map(w => w.toLowerCase()));

const dom = new JSDOM('');
globalThis.document = dom.window.document;
function plainText(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html.replace(/\[sound:[^\]]+\]/g, '').replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])>/gi, ' ');
  return (holder.textContent || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}
class UnsupportedTemplate extends Error {}
const escapeHTML = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function cloze(value, ordinal, answer) {
  return value.replace(/\{\{c(\d+)::([\s\S]*?)\}\}/g, (_, index, body) => {
    const [text, ...hint] = body.split('::');
    if (Number(index) !== ordinal + 1) return text;
    return answer ? `<strong class="cloze">${text}</strong>` : `<span class="cloze">[${hint.join('::') || '…'}]</span>`;
  });
}
function renderNote(model, values, ordinal, deckName, tags = '') {
  if (/image occlusion/i.test(model.name)) throw new UnsupportedTemplate('Image occlusion');
  const template = model.kind === 1 ? model.templates[0] : model.templates.find(t => t.ordinal === ordinal);
  if (!template) throw new UnsupportedTemplate('Missing card template');
  const fields = Object.create(null);
  model.fields.forEach((name, i) => fields[name] = values[i] || '');
  Object.assign(fields, { Deck: escapeHTML(deckName), Subdeck: escapeHTML(deckName.split('::').at(-1) || deckName), Tags: escapeHTML(tags), Type: escapeHTML(model.name), Card: String(ordinal + 1) });
  const render = (input, answer, front = '') => {
    let previous = '';
    for (let depth = 0; depth < 30 && previous !== input; depth++) {
      previous = input;
      input = input.replace(/\{\{([#^])([^{}]+)\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\2\}\}/g, (_, op, name, body) => {
        const present = !!(fields[name.trim()] || '').replace(/<[^>]*>/g, '').trim() || /<img\b|\[sound:/i.test(fields[name.trim()] || '');
        return (op === '#' ? present : !present) ? body : '';
      });
    }
    return input.replace(/\{\{([^{}]+)\}\}/g, (_, expression) => {
      if (expression === 'FrontSide') return front;
      const parts = expression.split(':');
      const field = parts.pop().trim();
      if (!(field in fields)) throw new UnsupportedTemplate(`Unknown field: ${field}`);
      let value = fields[field];
      for (const filter of parts.reverse()) {
        if (filter === 'cloze') value = cloze(value, ordinal, answer);
        else if (filter === 'text') value = value.replace(/<[^>]*>/g, '');
        else if (filter === 'type') { if (!answer) value = ''; }
        else throw new UnsupportedTemplate(`Unsupported filter: ${filter}`);
      }
      return value;
    });
  };
  const front = render(template.front, false);
  const back = render(template.back.replace(/\{\{FrontSide\}\}/g, '').replace(/<hr\b[^>]*id=["']?answer["']?[^>]*>/gi, ''), true, front);
  if (!front.trim() || !back.trim()) throw new UnsupportedTemplate('Empty card face');
  return { front, back };
}
function rows(db, sql) {
  const result = db.exec(sql)[0];
  return result ? result.values.map(values => Object.fromEntries(result.columns.map((name, i) => [name, values[i]]))) : [];
}
function noteTypesLegacy(db) {
  const result = new Map();
  const col = rows(db, 'SELECT models FROM col')[0];
  if (!col) throw new Error('This package has no Anki collection.');
  const models = JSON.parse(String(col.models));
  for (const [id, model] of Object.entries(models)) result.set(id, {
    name: model.name, kind: model.type,
    fields: [...model.flds].sort((a, b) => a.ord - b.ord).map(f => f.name),
    templates: model.tmpls.map(t => ({ ordinal: t.ord, front: t.qfmt, back: t.afmt })),
  });
  return result;
}
function deckNamesLegacy(db) {
  const json = JSON.parse(String(rows(db, 'SELECT decks FROM col')[0]?.decks || '{}'));
  return new Map(Object.entries(json).map(([id, deck]) => [id, deck.name]));
}
const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text);
CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld text, csum integer, flags integer, data text);
CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text);
CREATE TABLE revlog (id integer primary key, cid integer, usn integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer);
CREATE TABLE graves (usn integer, oid integer, type integer);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;
function checksum(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash;
}
function deckConfig(id, name) {
  return { id, mod: 0, name, usn: 0, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: true, browserCollapsed: true, desc: '', dyn: 0, conf: 1, extendNew: 0, extendRev: 0 };
}
function buildApkgLocal(deck, sql) {
  const db = new sql.Database();
  db.run(SCHEMA);
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const deckId = now;
  const modelId = now + 1;
  const conf = JSON.stringify({ curDeck: deckId, activeDecks: [deckId], curModel: String(modelId) });
  const decks = JSON.stringify({ [deckId]: deckConfig(deckId, deck.name), 1: deckConfig(1, 'Default') });
  const models = JSON.stringify({
    [modelId]: {
      id: modelId, name: 'Basic (Flashcards export)', type: 0, mod: nowSeconds, usn: 0, sortf: 0, did: deckId,
      flds: [
        { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20 },
        { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20 },
      ],
      tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}', did: null, bqfmt: '', bafmt: '' }],
      css: '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }',
      latexPre: '', latexPost: '', req: [[0, 'any', [0]]],
    },
  });
  const dconf = JSON.stringify({
    1: { id: 1, name: 'Default', new: { perDay: 20, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, bury: false }, rev: { perDay: 200, ease4: 1.3, ivlFct: 1, maxIvl: 36500, bury: false }, lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 1 }, maxTaken: 60, timer: 0, autoplay: true, replayq: true, mod: 0, usn: 0 },
  });
  db.run(
    'INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)',
    [nowSeconds, now, now, conf, models, decks, dconf, '{}'],
  );
  let id = now;
  for (const card of deck.cards) {
    const noteId = ++id, cardId = ++id;
    const sortField = plainText(card.front) || card.front;
    db.run(
      'INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?,?,?,?,0,?,?,?,?,0,?)',
      [noteId, String(noteId), modelId, nowSeconds, '', `${card.front}\x1f${card.back}`, sortField, checksum(sortField), ''],
    );
    db.run(
      'INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?,?,?,0,?,0,0,0,?,0,2500,0,0,0,0,0,0,?)',
      [cardId, noteId, deckId, nowSeconds, cardId - now, ''],
    );
  }
  const collection = db.export();
  db.close();
  const zipped = zipSync({ 'collection.anki2': collection, media: strToU8('{}') }, { level: 0 });
  return new Blob([zipped], { type: 'application/octet-stream' });
}

const sql = await initSqlJs();
const raw = new Uint8Array(await readFile(SOURCE));
const archive = unzipSync(raw);
const dbBytes = archive['collection.anki21'] || archive['collection.anki2'];
const db = new sql.Database(dbBytes);
const models = noteTypesLegacy(db);
const names = deckNamesLegacy(db);
const statement = db.prepare('SELECT c.id, c.did, c.odid, c.ord, n.mid, n.flds, n.tags FROM cards c JOIN notes n ON n.id=c.nid ORDER BY c.id');
const cards = [];
let skipped = 0;
while (statement.step()) {
  const row = statement.getAsObject();
  const did = String(row.odid || row.did);
  const model = models.get(String(row.mid));
  const name = names.get(did) || 'Goethe C1 Vocabulary';
  try {
    if (!model) throw new UnsupportedTemplate('Missing note type');
    const rendered = renderNote(model, String(row.flds).split('\x1f'), Number(row.ord), name, String(row.tags || ''));
    cards.push({ id: String(row.id), front: rendered.front, back: rendered.back });
  } catch (error) {
    if (!(error instanceof UnsupportedTemplate)) throw error;
    skipped++;
  }
}
statement.free();
db.close();
console.log(`Parsed ${cards.length} cards (${skipped} skipped as unsupported).`);

// This deck's front text often includes the declension/plural hint inline
// ("dieGalaxie, -n", "derMehrwehrt (Singular)") — strip everything from the first comma or
// opening parenthesis before normalizing, so those suffix letters don't get folded in.
const normalize = s => s.replace(/<[^>]+>/g, '').split(/[,(]/)[0].toLowerCase().replace(/[^a-zäöüßé/]/gi, '');
const cutFound = [];
const filteredCards = cards.filter(card => {
  const frontText = plainText(card.front);
  if (CUT_WORDS.has(normalize(frontText))) { cutFound.push(frontText); return false; }
  return true;
});
console.log(`Removing ${cards.length - filteredCards.length} of ${cards.length} cards.`);
console.log('Removed:', cutFound.join(', '));
if (cutFound.length !== CUT_WORDS.size) console.warn(`WARNING: expected to remove ${CUT_WORDS.size} words, only matched ${cutFound.length}. Check spelling/normalization.`);

const curatedDeck = { name: NEW_DECK_NAME, cards: filteredCards };
const blob = buildApkgLocal(curatedDeck, sql);
const buffer = Buffer.from(await blob.arrayBuffer());
await writeFile(OUTPUT, buffer);
console.log(`Wrote ${OUTPUT} (${(buffer.length / 1024).toFixed(0)} KB) with ${filteredCards.length} cards.`);
