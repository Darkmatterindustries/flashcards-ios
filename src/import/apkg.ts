import { unzipSync } from 'fflate';
import { Decompress } from 'fzstd';
import { type Database, type SqlJsStatic } from 'sql.js';
import { protobuf, protoText } from './protobuf';
import { renderNote, UnsupportedTemplate, type NoteType } from './templates';
import type { Deck, ImportResult, MediaFile } from '../model';

export const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 300 * 1024 * 1024;
const decoder = new TextDecoder();

function unzstd(data: Uint8Array, limit: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let size = 0;
  const stream = new Decompress(chunk => {
    size += chunk.length;
    if (size > limit) throw new Error('This deck is too large. Export a smaller deck and try again.');
    parts.push(chunk.slice());
  });
  // Small input chunks also bound transient decompressor output for ordinary files.
  for (let i = 0; i < data.length; i += 65536) stream.push(data.subarray(i, i + 65536), i + 65536 >= data.length);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

type Row = Record<string, string | number | Uint8Array | null>;
function rows(db: Database, sql: string): Row[] {
  const result = db.exec(sql)[0];
  return result ? result.values.map(values => Object.fromEntries(result.columns.map((name, i) => [name, values[i]]))) : [];
}

function noteTypes(db: Database): Map<string, NoteType> {
  const result = new Map<string, NoteType>();
  const modern = rows(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='notetypes'").length;
  if (modern) {
    const fields = rows(db, 'SELECT ntid, ord, name FROM fields ORDER BY ntid, ord');
    const templates = rows(db, 'SELECT ntid, ord, config FROM templates ORDER BY ntid, ord');
    for (const row of rows(db, 'SELECT id, name, config FROM notetypes')) {
      const config = protobuf(row.config as Uint8Array);
      result.set(String(row.id), {
        name: String(row.name), kind: Number(config.get(1)?.[0] || 0),
        fields: fields.filter(f => f.ntid === row.id).map(f => String(f.name)),
        templates: templates.filter(t => t.ntid === row.id).map(t => {
          const config = protobuf(t.config as Uint8Array);
          return { ordinal: Number(t.ord), front: protoText(config, 1), back: protoText(config, 2) };
        }),
      });
    }
  } else {
    const col = rows(db, 'SELECT models FROM col')[0];
    if (!col) throw new Error('This package has no Anki collection.');
    type Legacy = { name: string; type: number; flds: { name: string; ord: number }[]; tmpls: { ord: number; qfmt: string; afmt: string }[] };
    const models = JSON.parse(String(col.models)) as Record<string, Legacy>;
    for (const [id, model] of Object.entries(models)) result.set(id, {
      name: model.name, kind: model.type,
      fields: [...model.flds].sort((a, b) => a.ord - b.ord).map(f => f.name),
      templates: model.tmpls.map(t => ({ ordinal: t.ord, front: t.qfmt, back: t.afmt })),
    });
  }
  return result;
}

function deckNames(db: Database): Map<string, string> {
  if (rows(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='decks'").length) {
    return new Map(rows(db, 'SELECT id, name FROM decks').map(r => [String(r.id), String(r.name).replace(/\x1f/g, '::')]));
  }
  const json = JSON.parse(String(rows(db, 'SELECT decks FROM col')[0]?.decks || '{}')) as Record<string, { name: string }>;
  return new Map(Object.entries(json).map(([id, deck]) => [id, deck.name]));
}

function mediaType(name: string): string | undefined {
  const extension = name.split('.').at(-1)?.toLowerCase() || '';
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4' } as Record<string, string>)[extension];
}

export async function parseApkg(bytes: Uint8Array, filename: string, sql: SqlJsStatic): Promise<ImportResult> {
  if (!/\.apkg$/i.test(filename)) throw new Error('Choose an Anki deck ending in .apkg.');
  if (bytes.length > MAX_PACKAGE_BYTES) throw new Error('Choose an .apkg file smaller than 100 MB.');
  let expanded = 0;
  const archive = unzipSync(bytes, { filter(entry) {
    const keep = /^(collection\.anki(?:2|21|21b)|media|meta|\d+)$/.test(entry.name);
    if (keep) {
      expanded += entry.originalSize;
      if (expanded > MAX_EXPANDED_BYTES) throw new Error('This deck is too large. Export a smaller deck and try again.');
    }
    return keep;
  } });
  const modern = !!archive['collection.anki21b'];
  const collection = archive['collection.anki21b'] || archive['collection.anki21'] || archive['collection.anki2'];
  if (!collection) throw new Error('This file does not contain an Anki deck. Export it again as .apkg.');
  const databaseBytes = modern ? unzstd(collection, MAX_EXPANDED_BYTES) : collection;
  if (decoder.decode(databaseBytes.subarray(0, 15)) !== 'SQLite format 3') throw new Error('The Anki collection is damaged or unsupported.');
  // Local HTTP previews do not expose SubtleCrypto. Keep identical package IDs
  // there so duplicate detection and media references match the offline app.
  const hash = globalThis.crypto?.subtle
    ? await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
    : (await import('@noble/hashes/sha2.js')).sha256(bytes);
  const packageId = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  const db = new sql.Database(databaseBytes);
  const decks = new Map<string, Deck>();
  const skipped = new Map<string, number>();
  try {
    const models = noteTypes(db), names = deckNames(db);
    const count = Number(rows(db, 'SELECT COUNT(*) AS count FROM cards')[0]?.count || 0);
    if (count > 50000) throw new Error('This deck has more than 50,000 cards. Export a smaller deck.');
    const statement = db.prepare('SELECT c.id, c.did, c.odid, c.ord, n.mid, n.flds, n.tags FROM cards c JOIN notes n ON n.id=c.nid ORDER BY c.id');
    try {
      while (statement.step()) {
        const row = statement.getAsObject();
        const did = String(row.odid || row.did);
        const model = models.get(String(row.mid));
        const name = names.get(did) || filename.replace(/\.apkg$/i, '');
        try {
          if (!model) throw new UnsupportedTemplate('Missing note type');
          const rendered = renderNote(model, String(row.flds).split('\x1f'), Number(row.ord), name, String(row.tags || ''));
          if (!decks.has(did)) decks.set(did, { id: `${packageId}:${did}`, name, cards: [], reviewed: [], importedAt: Date.now(), packageId });
          decks.get(did)!.cards.push({ id: String(row.id), ...rendered });
        } catch (error) {
          if (!(error instanceof UnsupportedTemplate)) throw error;
          const reason = `${model?.name || 'Unknown note type'} (${error.message})`;
          skipped.set(reason, (skipped.get(reason) || 0) + 1);
        }
      }
    } finally { statement.free(); }
  } finally { db.close(); }
  if (!decks.size) throw new Error(skipped.size ? 'This deck uses unsupported card templates. Basic, reversed and cloze cards are supported.' : 'This package contains no cards.');
  const warnings = [...skipped].map(([reason, count]) => `${count} card${count === 1 ? '' : 's'} skipped: ${reason}.`);
  let map: [string, string][] = [];
  if (archive.media) {
    if (modern) {
      const entries = protobuf(unzstd(archive.media, MAX_EXPANDED_BYTES)).get(1) || [];
      map = entries.map((entry, i) => {
        const fields = protobuf(entry as Uint8Array);
        return [String(fields.get(255)?.[0] ?? i), protoText(fields, 1)];
      });
    } else map = Object.entries(JSON.parse(decoder.decode(archive.media)) as Record<string, string>);
  }
  const media: MediaFile[] = [];
  let mediaSize = databaseBytes.length;
  let missing = 0;
  for (const [index, name] of map) {
    if (typeof name !== 'string') throw new Error('Invalid media list in this package.');
    const type = mediaType(name);
    if (!type) continue;
    const data = archive[index];
    if (!data) { missing++; continue; }
    const content = modern ? unzstd(data, MAX_EXPANDED_BYTES - mediaSize) : data;
    mediaSize += content.length;
    if (mediaSize > MAX_EXPANDED_BYTES) throw new Error('This deck has too much media. Export a smaller deck.');
    media.push({ id: `${packageId}:${name}`, packageId, name, data: content.slice().buffer, mime: type });
  }
  if (missing) warnings.push(`${missing} media file${missing === 1 ? ' is' : 's are'} missing from this package.`);
  return { decks: [...decks.values()], media, warnings, packageId };
}
