// Resumable full-catalog conversion followed by verified IPA packaging.
import { spawn } from 'node:child_process';
import { readFile, writeFile, open, unlink, stat, copyFile } from 'node:fs/promises';
const input = 'artifacts/katja-all-pronunciation.txt';
const statusPath = 'artifacts/katja-rebuild-status.json';
const lockPath = 'artifacts/katja-rebuild.lock';
const python = 'C:/Users/maazl/AppData/Local/Python/pythoncore-3.14-64/python.exe';
const status = async (stage, detail = '') => writeFile(statusPath, JSON.stringify({ stage, detail, updatedAt: new Date().toISOString() }, null, 2));
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
});
let lock;
try {
  lock = await open(lockPath, 'wx');
  await lock.writeFile(String(process.pid));
  await copyFile('src/pronunciation-recordings.json', `artifacts/pronunciation-before-katja-${Date.now()}.json`);
  await status('generating');
  await run(process.execPath, ['scripts/audio/generate-azure-pronunciation.mjs', input, '--replace-all', '--generate']);
  const words = (await readFile(input, 'utf8')).trim().split(/\r?\n/);
  const manifest = JSON.parse(await readFile('src/pronunciation-recordings.json', 'utf8'));
  for (const word of words) {
    const clip = Object.hasOwn(manifest, word) ? manifest[word] : undefined;
    if (!clip || clip.provider !== 'azure' || clip.voiceId !== 'de-DE-KatjaNeural' || !/^[a-f0-9]{64}\.mp3$/.test(clip.file)) throw new Error('Incomplete Katja coverage; packaging stopped.');
    if ((await stat(`public/pronunciation/${clip.file}`)).size < 100) throw new Error('Invalid audio file; packaging stopped.');
  }
  await status('building', `${words.length} phrases verified as Katja`);
  await run('cmd.exe', ['/d', '/s', '/c', 'npm.cmd run build']);
  await run(python, ['scripts/packaging/package-offline-ipa.py']);
  await run(python, ['scripts/packaging/prepare-live-ipa.py', 'http://192.168.0.197:5173', '--source', 'artifacts/Flashcards-3.0-unsigned.ipa', '--output', 'artifacts/Flashcards-Live-unsigned.ipa']);
  await status('complete', `${words.length} phrases use Katja. Offline and Live IPAs rebuilt.`);
  console.log('COMPLETE: all requested phrases use Katja; both IPA files rebuilt.');
} catch (error) {
  if (lock) await status('failed', error.message);
  console.error(error.message); process.exitCode = 1;
} finally {
  if (lock) { await lock.close(); await unlink(lockPath); }
}
