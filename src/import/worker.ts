import { parseApkg } from './apkg';
import initSqlJs from 'sql.js';

self.onmessage = async (event: MessageEvent<{ buffer: ArrayBuffer; name: string; wasm: ArrayBuffer }>) => {
  try {
    const sql = await initSqlJs({ wasmBinary: event.data.wasm });
    const result = await parseApkg(new Uint8Array(event.data.buffer), event.data.name, sql);
    self.postMessage({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    self.postMessage({ error: /^(Choose |This |The Anki )/.test(message) ? message : 'This package could not be read. Please export it again from Anki as .apkg.' });
  }
};
