import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const model = 'qwen3.5:9b';
const started = new Date().toISOString();
const status = async (state, extra = {}) => writeFile('artifacts/grammar-local-status.json', JSON.stringify({ model, started, updated: new Date().toISOString(), state, ...extra }, null, 2));
try {
  const deadline = Date.now() + 2 * 60 * 60 * 1000;
  while (true) {
    const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Model service returned HTTP ${response.status}`);
    const result = await response.json();
    if (result.models?.some(item => item.name === model)) break;
    if (Date.now() > deadline) throw new Error('Download wait exceeded two hours. Resume after checking the download.');
    await status('waiting-for-download');
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
  await status('running-pilot');
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/grammar/pilot-local-grammar.mjs', model], { stdio: 'inherit', windowsHide: true });
    child.once('error', reject); child.once('exit', resolve);
  });
  if (code !== 0) throw new Error(`Pilot exited with code ${code}; inspect artifacts/grammar-local-pilot.log.`);
  await status('awaiting-linguistic-review', { note: 'Pilot drafts only. Full-deck generation has not started.' });
} catch (error) {
  await status('failed', { error: error.message });
  console.error(error.message); process.exitCode = 1;
}
