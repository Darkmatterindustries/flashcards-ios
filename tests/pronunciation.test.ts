// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/pronunciation-recordings.json', () => ({ default: {
  'der Entwurf': { file: `${'a'.repeat(64)}.mp3`, voiceId: 'test', model: 'test' },
} }));
import { normalizeSpeech, preferredGermanVoice, pronounce, stopPronunciation } from '../src/pronunciation';
import { defaultSettings } from '../src/model';

afterEach(() => { stopPronunciation(); vi.unstubAllGlobals(); });

it('respects the chosen German voice and otherwise prefers Premium', () => {
  const voices = [
    { lang: 'de-DE', name: 'Anna', voiceURI: 'anna', localService: true },
    { lang: 'de-DE', name: 'Anna (Premium)', voiceURI: 'premium', localService: true },
    { lang: 'en-US', name: 'English Premium', voiceURI: 'english' },
  ] as SpeechSynthesisVoice[];
  expect(preferredGermanVoice(voices, '')?.voiceURI).toBe('premium');
  expect(preferredGermanVoice(voices, 'anna')?.voiceURI).toBe('anna');
  expect(normalizeSpeech('  der\n Entwurf ')).toBe('der Entwurf');
});

it('plays saved audio, falls back once on error, and ignores failures after navigation', async () => {
  const speak = vi.fn();
  vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), speak, getVoices: () => [] });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  const players: FakeAudio[] = [];
  class FakeAudio {
    onerror: (() => void) | null = null;
    playbackRate = 1; preservesPitch = true;
    reject!: (error: Error) => void;
    constructor(public src: string) { players.push(this); }
    play() { return new Promise<void>((_, reject) => { this.reject = reject; }); }
    pause() {} removeAttribute() {} load() {}
  }
  vi.stubGlobal('Audio', FakeAudio);
  pronounce('der Entwurf', defaultSettings);
  expect(players[0].src).toContain('/pronunciation/');
  expect(speak).not.toHaveBeenCalled();
  players[0].onerror?.(); players[0].reject(new Error('missing file'));
  await Promise.resolve();
  expect(speak).toHaveBeenCalledTimes(1);
  pronounce('der Entwurf', defaultSettings);
  stopPronunciation();
  players[1].reject(new Error('cancelled'));
  await Promise.resolve();
  expect(speak).toHaveBeenCalledTimes(1);
  pronounce('new word', defaultSettings);
  expect(speak).toHaveBeenCalledTimes(2);
});
