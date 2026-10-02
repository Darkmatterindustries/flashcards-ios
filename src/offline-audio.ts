import { openDB } from 'idb';
import recordings from './pronunciation-recordings.json';
import { plainText } from './speech-text';
import type { Card } from './model';
const catalog: Record<string, { file: string }> = recordings;
let database: ReturnType<typeof openDB> | undefined;
const db = () => database ??= openDB('flashcards-audio', 1, { upgrade(database) { database.createObjectStore('clips'); } });
const urls = new Map<string, string>();
let warmGeneration = 0;
export function recordingFile(text: string) {
  const key = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  return Object.hasOwn(catalog, key) ? catalog[key].file : undefined;
}
export function deckFiles(cards: Card[]) {
  return [...new Set(cards.map(c => recordingFile(plainText(c.front))).filter((file): file is string => !!file))];
}
export function cachedAudioUrl(file: string) { return urls.get(file); }
export async function warmAudio(cards: Card[]) {
  const generation = ++warmGeneration;
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  const store = await db();
  for (const file of deckFiles(cards)) {
    const blob = await store.get('clips', file) as Blob | undefined;
    if (generation !== warmGeneration) return;
    if (blob) urls.set(file, URL.createObjectURL(blob));
  }
}
export async function audioCoverage(cards: Card[]) {
  const store = await db();
  const files = deckFiles(cards);
  let downloaded = 0, bytes = 0;
  for (const file of files) {
    const blob = await store.get('clips', file) as Blob | undefined;
    if (blob) { downloaded++; bytes += blob.size; }
  }
  return { available: files.length, coveredCards: cards.filter(c => recordingFile(plainText(c.front))).length, downloaded, bytes };
}
export async function downloadDeckAudio(cards: Card[], progress: (done: number, total: number) => void, signal: AbortSignal) {
  const store = await db();
  const files = deckFiles(cards);
  let done = 0;
  for (const file of files) {
    signal.throwIfAborted();
    if (!await store.get('clips', file)) {
      const response = await fetch(`${import.meta.env.BASE_URL}pronunciation/${file}`, { signal });
      if (!response.ok) throw new Error('A clip could not download. Reconnect and resume.');
      const blob = await response.blob();
      if (!blob.type.startsWith('audio/') || !blob.size) throw new Error('The server did not return an audio file.');
      await store.put('clips', blob, file);
    }
    progress(++done, files.length);
  }
}
