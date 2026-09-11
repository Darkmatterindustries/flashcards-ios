// Small wire-format reader for Anki's package, template and notetype metadata.
// Unknown fields are skipped so additional metadata remains forwards compatible.
type Value = number | Uint8Array;
export function protobuf(data: Uint8Array): Map<number, Value[]> {
  let offset = 0;
  const result = new Map<number, Value[]>();
  const varint = () => {
    let value = 0, factor = 1;
    for (let i = 0; i < 10; i++) {
      if (offset >= data.length) throw new Error('Incomplete Anki metadata.');
      const byte = data[offset++];
      value += (byte & 127) * factor;
      if (!(byte & 128)) return value;
      factor *= 128;
    }
    throw new Error('Invalid Anki metadata.');
  };
  while (offset < data.length) {
    const tag = varint(), field = Math.floor(tag / 8), wire = tag & 7;
    if (!field) throw new Error('Invalid Anki metadata.');
    let value: Value;
    if (wire === 0) value = varint();
    else if (wire === 2) {
      const length = varint();
      if (offset + length > data.length) throw new Error('Incomplete Anki metadata.');
      value = data.slice(offset, offset + length); offset += length;
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4;
      if (offset > data.length) throw new Error('Incomplete Anki metadata.');
      continue;
    } else throw new Error('Unsupported Anki metadata.');
    result.set(field, [...(result.get(field) || []), value]);
  }
  return result;
}
export function protoText(fields: Map<number, Value[]>, key: number) {
  const value = fields.get(key)?.[0];
  return value instanceof Uint8Array ? new TextDecoder().decode(value) : '';
}
