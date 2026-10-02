// Computer-only generation. Keys never enter the application or IPA.
import { readFile, writeFile, mkdir, access, rename, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

try { process.loadEnvFile('.env.azure'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const args = process.argv.slice(2);
const key = process.env.AZURE_SPEECH_KEY;
const region = process.env.AZURE_SPEECH_REGION;
const voiceId = process.env.AZURE_SPEECH_VOICE || 'de-DE-KatjaNeural';
const exists = path => access(path).then(() => true, () => false);
const escapeXml = text => text.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
async function save(path, content) {
  await writeFile(`${path}.tmp`, content);
  for (let attempt = 0; ; attempt++) {
    try { await rename(`${path}.tmp`, path); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 12) throw error;
      await delay(200 * (attempt + 1));
    }
  }
}
async function synthesize(text, voice) {
  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'FlashcardsAudioGenerator' },
    body: `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="de-DE"><voice name="${escapeXml(voice)}">${escapeXml(text)}</voice></speak>`,
  });
  if (!response.ok) throw new Error(`Azure returned HTTP ${response.status}. Check the key, region, quota and voice. No automatic retry was made.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.headers.get('content-type')?.includes('audio/') || bytes.length < 100) throw new Error('Azure did not return audio.');
  return bytes;
}
async function main() {
  const samples = args.includes('--samples');
  const replaceAll = args.includes('--replace-all');
  const input = args.find(arg => !arg.startsWith('--')) || (samples ? 'docs/pronunciation-sample.txt' : 'artifacts/imported-pronunciation.txt');
  const words = [...new Set((await readFile(input, 'utf8')).split(/\r?\n/).map(t => t.normalize('NFC').replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (!words.length || words.some(t => t.length > 1000)) throw new Error('Provide one short phrase per line, at most 1,000 characters.');
  if (!/^de-DE-[a-zA-Z0-9]+Neural$/.test(voiceId)) throw new Error('Use a German Azure Neural voice name in AZURE_SPEECH_VOICE.');
  const manifestPath = 'src/pronunciation-recordings.json';
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const folder = samples ? 'public/voice-samples' : 'public/pronunciation';
  const jobs = [];
  for (const text of words) {
    const existing = Object.hasOwn(manifest, text) ? manifest[text] : undefined;
    if (!samples && !replaceAll && existing && /^[a-f0-9]{64}\.mp3$/.test(existing.file) && await exists(`public/pronunciation/${existing.file}`)) continue;
    for (const voice of samples ? ['de-DE-KatjaNeural', 'de-DE-ConradNeural'] : [voiceId]) {
      const file = `${createHash('sha256').update(JSON.stringify({ provider: 'azure', voice, text })).digest('hex')}.mp3`;
      jobs.push({ text, voice, file, cached: await exists(`${folder}/${file}`), sampleCached: !samples && await exists(`public/voice-samples/${file}`) });
    }
  }
  const pending = jobs.filter(j => !j.cached && !j.sampleCached);
  console.log(`${pending.length} clips to generate; ${pending.reduce((sum, j) => sum + j.text.length, 0)} text characters. ${replaceAll ? `All input phrases will use ${voiceId}; completed clips are reused.` : 'Existing deck recordings are preserved.'}`);
  if (!args.includes('--generate')) { console.log('Dry run. Add --generate to use your Azure Speech allowance.'); return; }
  if (pending.length && (!key || key.includes('paste_') || !/^[a-z][a-z0-9]{2,40}$/.test(region || ''))) throw new Error('Fill AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env.azure first.');
  await mkdir(folder, { recursive: true });
  let completed = 0;
  for (const job of jobs) {
    if (!job.cached && job.sampleCached) await copyFile(`public/voice-samples/${job.file}`, `${folder}/${job.file}`);
    else if (!job.cached) {
      await save(`${folder}/${job.file}`, await synthesize(job.text, job.voice));
      // Pace requests for the free resource; stop on errors instead of retrying charges.
      await delay(3100);
    }
    if (!samples) {
      Object.defineProperty(manifest, job.text, { enumerable: true, configurable: true, writable: true,
        value: { file: job.file, voiceId: job.voice, model: 'neural', provider: 'azure' } });
      await save(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }
    console.log(`Saved ${++completed}/${jobs.length}.`);
    if (!samples) await save('artifacts/azure-pronunciation-progress.json', JSON.stringify({ voice: voiceId, completed, total: jobs.length, updatedAt: new Date().toISOString() }) + '\n');
  }
  if (samples) {
    await save(`${folder}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>German voice samples</title><style>body{font:18px system-ui;max-width:600px;margin:30px auto;padding:20px}audio{width:100%}section{margin:30px 0}</style><h1>Compare German voices</h1><p>Azure AI-generated pronunciation. Choose the voice you prefer.</p>${jobs.map(j => `<section><h2>${escapeXml(j.voice)}</h2><p>${escapeXml(j.text)}</p><audio controls preload="none" src="${j.file}"></audio></section>`).join('')}</html>`);
    console.log('Open /voice-samples/ in Live Safari to compare. Samples do not replace deck recordings.');
  } else await import('./audio-summary.mjs');
}
main().catch(error => { console.error(key ? error.message.replaceAll(key, '[redacted]') : error.message); process.exitCode = 1; });
