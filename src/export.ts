import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmURL from 'sql.js/dist/sql-wasm.wasm?url';
import { zipSync, strToU8 } from 'fflate';
import type { Deck } from './model';
import { plainText } from './speech-text';

let sqlPromise: ReturnType<typeof initSqlJs> | undefined;
function loadSql() {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const response = await fetch(wasmURL);
      if (!response.ok) throw new Error('The exporter could not load. Please reopen the app.');
      const wasmBinary = await response.arrayBuffer();
      return initSqlJs({ wasmBinary });
    })();
  }
  return sqlPromise;
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

/** Anki uses this only for its own duplicate-detection UI, not to validate imports. */
function checksum(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash;
}

function deckConfig(id: number, name: string) {
  return { id, mod: 0, name, usn: 0, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: true, browserCollapsed: true, desc: '', dyn: 0, conf: 1, extendNew: 0, extendRev: 0 };
}

/**
 * Builds a legacy (schema 11) .apkg — the classic JSON-in-SQLite format every
 * Anki version can still import. Bundled images/audio aren't included, since
 * this app doesn't keep a byte-for-byte copy of a deck's original media file
 * names; card text (including any [sound:] references) exports as-is.
 */
export function buildApkg(deck: Deck, sql: SqlJsStatic): Blob {
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

export async function exportDeckToApkg(deck: Deck): Promise<Blob> {
  return buildApkg(deck, await loadSql());
}

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Deck';
}

export function apkgFileName(deckName: string) {
  return `${safeFileName(deckName)}.apkg`;
}
