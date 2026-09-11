import type { ImportResult } from '../model';
import ImportWorker from './worker?worker&inline';
import wasmURL from 'sql.js/dist/sql-wasm.wasm?url';

export async function importFile(file: File): Promise<ImportResult> {
  if (!/\.apkg$/i.test(file.name)) throw new Error('Choose an Anki deck ending in .apkg.');
  if (file.size > 100 * 1024 * 1024) throw new Error('Choose an .apkg file smaller than 100 MB.');
  const buffer = await file.arrayBuffer();
  // WKWebView custom schemes are served by the main web view's asset handler.
  // Pass WASM bytes to an inline Blob worker so it never fetches capacitor:// URLs.
  const response = await fetch(wasmURL);
  if (!response.ok) throw new Error('The importer could not load. Please reopen the app.');
  const wasm = await response.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new ImportWorker();
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    const timer = setTimeout(() => { finish(); reject(new Error('This import is taking too long. Export a smaller deck and try again.')); }, 60000);
    worker.onmessage = event => {
      finish();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result);
    };
    worker.onerror = () => { finish(); reject(new Error('The import could not finish. Try a smaller .apkg file.')); };
    worker.postMessage({ buffer, name: file.name, wasm }, [buffer, wasm]);
  });
}
