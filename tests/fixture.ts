import initSqlJs from 'sql.js';
import { zipSync, strToU8 } from 'fflate';
import { zstdCompressSync } from 'node:zlib';

export const sql = initSqlJs();
const text = (value: string) => new TextEncoder().encode(value);
function varint(value: number): number[] {
  const bytes = [];
  do { const lower = value & 127; value = Math.floor(value / 128); bytes.push(lower | (value ? 128 : 0)); } while (value);
  return bytes;
}
export function proto(fields: [number, string | number | Uint8Array][]) {
  return new Uint8Array(fields.flatMap(([key, value]) => {
    if (typeof value === 'number') return [...varint(key * 8), ...varint(value)];
    const bytes = typeof value === 'string' ? text(value) : value;
    return [...varint(key * 8 + 2), ...varint(bytes.length), ...bytes];
  }));
}

export async function fixture(modern = false, options: { empty?: boolean; unsupported?: boolean } = {}) {
  const SQL = await sql, db = new SQL.Database();
  db.run('CREATE TABLE cards (id integer, nid integer, did integer, odid integer, ord integer); CREATE TABLE notes (id integer, mid integer, flds text, tags text);');
  const models = {
    1: { name: options.unsupported ? 'Image Occlusion' : 'Basic', type: 0, flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }], tmpls: [{ ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' }, { ord: 1, qfmt: '{{Back}}', afmt: '{{Front}}' }] },
    2: { name: 'Cloze', type: 1, flds: [{ name: 'Text', ord: 0 }, { name: 'Extra', ord: 1 }], tmpls: [{ ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Extra}}' }] },
  };
  if (modern) {
    db.run('CREATE TABLE notetypes (id integer, name text, config blob); CREATE TABLE fields (ntid integer, ord integer, name text); CREATE TABLE templates (ntid integer, ord integer, config blob); CREATE TABLE decks (id integer, name text);');
    db.run('INSERT INTO decks VALUES (10, ?), (20, ?)', ['Imported Basics', 'Science\x1fCells']);
    for (const [id, model] of Object.entries(models)) {
      db.run('INSERT INTO notetypes VALUES (?, ?, ?)', [Number(id), model.name, proto([[1, model.type]])]);
      for (const field of model.flds) db.run('INSERT INTO fields VALUES (?, ?, ?)', [Number(id), field.ord, field.name]);
      for (const template of model.tmpls) db.run('INSERT INTO templates VALUES (?, ?, ?)', [Number(id), template.ord, proto([[1, template.qfmt], [2, template.afmt]])]);
    }
  } else {
    db.run('CREATE TABLE col (models text, decks text)');
    db.run('INSERT INTO col VALUES (?, ?)', [JSON.stringify(models), JSON.stringify({ 10: { name: 'Imported Basics' }, 20: { name: 'Science::Cells' } })]);
  }
  if (!options.empty) {
    db.run('INSERT INTO notes VALUES (1,1,?,?), (2,2,?,?)', ['Capital of France?\x1fParis<img src="pixel.png">', 'geography', 'The {{c1::nucleus::organelle}} contains {{c2::DNA}}.\x1fCell biology', 'science']);
    db.run('INSERT INTO cards VALUES (101,1,10,0,0),(102,1,10,0,1),(201,2,20,0,0),(202,2,20,0,1)');
  }
  const data = db.export(); db.close();
  const pixel = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPIXPAcAANmAfEdlZmyAAAAAElFTkSuQmCC', 'base64'));
  return modern ? zipSync({
    'collection.anki21b': zstdCompressSync(data),
    // Modern exports contain a legacy placeholder that must not be imported.
    'collection.anki2': strToU8('This is not the real collection'),
    meta: proto([[1, 3]]),
    media: zstdCompressSync(proto([[1, proto([[1, 'pixel.png'], [2, pixel.length]])]])),
    '0': zstdCompressSync(pixel),
  }) : zipSync({ 'collection.anki2': data, media: strToU8('{"0":"pixel.png"}'), '0': pixel });
}
