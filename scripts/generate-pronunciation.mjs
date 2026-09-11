// Runs only on the computer. No provider credentials enter the app bundle.
import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Vite or antivirus can briefly hold the destination open on Windows.
// Retry file replacement only; never retry a paid synthesis request automatically.
async function replaceFile(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, destination); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 12) throw error;
      await delay(200 * (attempt + 1));
    }
  }
}

try { process.loadEnvFile('.env.elevenlabs'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const args = process.argv.slice(2);
const key = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.ELEVENLABS_VOICE_ID;
const model = 'eleven_multilingual_v2';
const normalize = text => text.normalize('NFC').replace(/\s+/g, ' ').trim();
const digest = text => createHash('sha256').update(text).digest('hex');
const exists = path => access(path).then(() => true, () => false);

async function request(path, init = {}) {
  if (!key || key === 'paste_your_key_here') throw new Error('Set ELEVENLABS_API_KEY in .env.elevenlabs on this computer.');
  const response = await fetch(`https://api.elevenlabs.io${path}`, {
    ...init, headers: { 'xi-api-key': key, ...init.headers }, signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.detail?.message === 'string' ? body.detail.message.replaceAll(key, '[redacted]').slice(0, 500) : 'Check your API permissions, voice ID and credit balance.';
    throw new Error(`ElevenLabs returned HTTP ${response.status}: ${detail} No automatic retry was made.`);
  }
  return response;
}

async function main() {
  if (args.includes('--voices')) {
    const data = await (await request('/v2/voices?page_size=100')).json();
    for (const voice of data.voices ?? []) console.log(`${voice.voice_id}\t${voice.name}\t${JSON.stringify(voice.labels ?? {})}`);
    if (data.has_more) console.log('More voices are available in your ElevenLabs voice library.');
    return;
  }
  const input = args.find(arg => !arg.startsWith('--')) ?? 'docs/pronunciation-sample.txt';
  const words = [...new Set((await readFile(input, 'utf8')).split(/\r?\n/).map(normalize).filter(Boolean))];
  if (!words.length || words.some(word => word.length > 1000)) throw new Error('Use one word or short phrase per line (maximum 1,000 characters per phrase).');
  const manifestPath = resolve('src/pronunciation-recordings.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const jobs = [];
  for (const text of words) {
    const filename = `${digest(JSON.stringify({ text, voiceId, model }))}.mp3`;
    const path = resolve('public/pronunciation', filename);
    jobs.push({ text, filename, path, cached: await exists(path) });
  }
  const pending = jobs.filter(job => !job.cached);
  console.log(`${words.length} unique phrases; ${pending.length} to generate; ${pending.reduce((sum, job) => sum + job.text.length, 0)} text characters to send.`);
  if (!args.includes('--generate')) {
    console.log('Dry run only. Add --generate to use ElevenLabs credits and save the audio.');
    return;
  }
  if (!voiceId || !/^[a-zA-Z0-9_-]+$/.test(voiceId)) throw new Error('Set ELEVENLABS_VOICE_ID in .env.elevenlabs. Use --voices to list your voices.');
  await mkdir('public/pronunciation', { recursive: true });
  let completed = 0;
  let nextJob = 0;
  let failure;
  let saveQueue = Promise.resolve();
  const saveManifest = () => {
    const snapshot = JSON.stringify(manifest, null, 2) + '\n';
    saveQueue = saveQueue.then(async () => {
      await writeFile(`${manifestPath}.tmp`, snapshot);
      await replaceFile(`${manifestPath}.tmp`, manifestPath);
    });
    return saveQueue;
  };
  const processJob = async (job) => {
    if (!job.cached) {
      const response = await request(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: job.text, model_id: model, voice_settings: { stability: 0.65, similarity_boost: 0.75, style: 0, use_speaker_boost: true } }),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.headers.get('content-type')?.includes('audio/') || bytes.length < 100) throw new Error('ElevenLabs did not return a valid audio response.');
      await writeFile(`${job.path}.tmp`, bytes);
      await replaceFile(`${job.path}.tmp`, job.path);
    }
    Object.defineProperty(manifest, job.text, { value: { file: job.filename, voiceId, model }, enumerable: true, configurable: true, writable: true });
    completed++;
    if (completed % 25 === 0) { await saveManifest(); console.log(`Saved ${completed}/${jobs.length} phrases.`); }
  };
  const worker = async () => {
    while (!failure && nextJob < jobs.length) {
      const job = jobs[nextJob++];
      try { await processJob(job); } catch (error) { failure = error; }
    }
  };
  // Two requests at a time, with no automatic retries that might duplicate charges.
  await Promise.all([worker(), worker()]);
  await saveManifest();
  await import('./audio-summary.mjs');
  console.log(`Saved ${completed}/${jobs.length} phrases in this run.`);
  if (failure) throw failure;
  console.log('Ready. Live preview will reload; normal IPA builds bundle these files for offline playback.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
