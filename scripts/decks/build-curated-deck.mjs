// Regenerates a curated version of German_C1_Vocabulary.apkg with the narrow, off-topic
// jargon cluster removed (space/deep-sea/volcanology vocabulary that leaked in from a handful
// of thematic source reading passages) while keeping every genuinely useful C1 word, including
// general words that happened to share a tag with the jargon.
//
// Self-contained: does NOT go through Vite's SSR module runner (it hung repeatedly against
// src/import/apkg.ts in this environment). Instead this inlines faithful, unmodified copies of
// the small pieces of logic actually needed from src/import/apkg.ts, src/import/templates.ts,
// src/speech-text.ts and src/export.ts (legacy-schema path only — this file has no notetypes/
// decks tables, so the modern/protobuf branch is not needed).
import { readFile, writeFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strToU8 } from 'fflate';

const SOURCE = 'flashcarddecks/German_C1_Vocabulary.apkg';
const OUTPUT = 'flashcarddecks/German_C1_Vocabulary_Curated.apkg';
const NEW_DECK_NAME = 'German C1 Vocabulary (Curated)';

const CUT_WHOLE_TAG = 'Teil2-NomenFachlich';
const CUT_FROM_NOMEN3 = new Set([
  'dieAlge', 'derMeeresgrund', 'derKontinentalhang', 'derTintenfisch', 'dieSeegurke', 'derOktopus',
  'derRaubfisch', 'dieEruption', 'derVulkanausbruch', 'dasArchipel', 'dieZerstörungskraft',
  'dieSchwerkraft', 'dieSprengkraft', 'derLuftwiderstand', 'dasHelium', 'dieMondoberfläche',
  'derMondstaub', 'dieGalaxie', 'derSternwind', 'dasAerosol', 'derGasriese',
  'dieOberflächentemperatur', 'dieKüstennähe', 'derGrößenvergleich', 'dasGrößenverhältnis',
  'dasZehntausend', 'derFeuerball', 'dieDruckwelle', 'dieErdoberfläche', 'dieStratosphäre',
]);
// Individually identified strays outside the tag clusters above (found on a closer re-read),
// matched purely by normalized word text regardless of tag.
const CUT_EXTRA = new Set(['massereich'].map(w => w.toLowerCase()));

// --- src/speech-text.ts (verbatim) --------------------------------------------------------
const dom = new JSDOM('');
globalThis.document = dom.window.document;
function plainText(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html.replace(/\[sound:[^\]]+\]/g, '').replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])>/gi, ' ');
  return (holder.textContent || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

// --- src/import/templates.ts (verbatim) ----------------------------------------------------
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

// --- src/import/apkg.ts (legacy-schema path only, verbatim logic) --------------------------
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

// --- src/export.ts buildApkg (verbatim, taking plainText as a parameter) -------------------
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

// --- main -----------------------------------------------------------------------------------
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
  const name = names.get(did) || 'German C1 Vocabulary';
  try {
    if (!model) throw new UnsupportedTemplate('Missing note type');
    const rendered = renderNote(model, String(row.flds).split('\x1f'), Number(row.ord), name, String(row.tags || ''));
    cards.push({ id: String(row.id), front: rendered.front, back: rendered.back, tags: String(row.tags || '').trim().split(/\s+/).filter(Boolean) });
  } catch (error) {
    if (!(error instanceof UnsupportedTemplate)) throw error;
    skipped++;
  }
}
statement.free();
db.close();
console.log(`Parsed ${cards.length} cards (${skipped} skipped as unsupported).`);

const normalize = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-zäöüßé]/gi, '');
const cutNomen3Normalized = new Set([...CUT_FROM_NOMEN3].map(normalize));
const cutWords = [];
const filteredCards = cards.filter(card => {
  const frontText = plainText(card.front);
  const norm = normalize(frontText);
  const cutByTag = card.tags.includes(CUT_WHOLE_TAG);
  const cutByNomen3 = card.tags.includes('Teil2-Nomen3') && cutNomen3Normalized.has(norm);
  const cutByExtra = CUT_EXTRA.has(norm);
  if (cutByTag || cutByNomen3 || cutByExtra) { cutWords.push(frontText); return false; }
  return true;
});

console.log(`Removing ${cards.length - filteredCards.length} of ${cards.length} cards.`);
console.log('Removed words:', cutWords.sort().join(', '));

const curatedDeck = { name: NEW_DECK_NAME, cards: filteredCards };
const blob = buildApkgLocal(curatedDeck, sql);
const buffer = Buffer.from(await blob.arrayBuffer());
await writeFile(OUTPUT, buffer);
console.log(`Wrote ${OUTPUT} (${(buffer.length / 1024).toFixed(0)} KB) with ${filteredCards.length} cards.`);
