import recordings from './pronunciation-recordings.json';
import type { AppSettings } from './model';
import { cachedAudioUrl } from './offline-audio';

type Recording = { file: string; voiceId: string; model: string };
const clips: Record<string, Recording> = recordings;
export const recordingCount = Object.keys(clips).length;
export const normalizeSpeech = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();

export function preferredGermanVoice(voices: SpeechSynthesisVoice[], selected: string) {
  const german = voices.filter(v => /^de(?:-|_)/i.test(v.lang));
  const chosen = german.find(v => v.voiceURI === selected);
  if (chosen) return chosen;
  const score = (v: SpeechSynthesisVoice) =>
    (/premium/i.test(v.name) ? 100 : /enhanced/i.test(v.name) ? 50 : 0) +
    (/^de-DE$/i.test(v.lang) ? 10 : 0) + (v.localService ? 1 : 0);
  return german.sort((a, b) => score(b) - score(a))[0];
}

let audio: HTMLAudioElement | undefined;
let utterance: SpeechSynthesisUtterance | undefined;
let generation = 0;
export function stopPronunciation() {
  generation++;
  if (audio) { audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load(); audio = undefined; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  utterance = undefined;
}

export function pronounce(text: string, settings: AppSettings) {
  stopPronunciation();
  const token = generation;
  const normalized = normalizeSpeech(text);
  if (!normalized) return;
  let fallbackStarted = false;
  const fallback = () => {
    if (token !== generation || fallbackStarted || !('speechSynthesis' in window)) return;
    fallbackStarted = true;
    utterance = new SpeechSynthesisUtterance(normalized);
    utterance.lang = 'de-DE';
    utterance.rate = settings.speechRate;
    const voice = preferredGermanVoice(speechSynthesis.getVoices(), settings.voiceURI);
    if (voice) utterance.voice = voice;
    speechSynthesis.speak(utterance);
  };
  const clip = Object.hasOwn(clips, normalized) ? clips[normalized] : undefined;
  if (settings.preferRecordedAudio !== false && clip && /^[a-f0-9]{64}\.mp3$/.test(clip.file)) {
    audio = new Audio(cachedAudioUrl(clip.file) ?? `${import.meta.env.BASE_URL}pronunciation/${clip.file}`);
    audio.playbackRate = settings.speechRate;
    audio.preservesPitch = true;
    audio.onerror = fallback;
    void audio.play().catch(fallback);
  } else fallback();
}
