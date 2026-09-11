import { readFile, stat, writeFile } from 'node:fs/promises';
const clips = Object.values(JSON.parse(await readFile('src/pronunciation-recordings.json', 'utf8')));
const files = [...new Set(clips.map(clip => clip.file))];
let bytes = 0;
for (const file of files) {
  if (!/^[a-f0-9]{64}\.mp3$/.test(file)) throw new Error('Invalid pronunciation filename');
  bytes += (await stat(`public/pronunciation/${file}`)).size;
}
await writeFile('src/generated-audio-summary.json', JSON.stringify({ files: files.length, bytes }) + '\n');
