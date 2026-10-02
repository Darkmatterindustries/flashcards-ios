import { plainText } from './speech-text';
import examples from './grammar-examples.json';

export const cases = [
  ['nominative', 'Nominative (The Subject)'],
  ['genitive', 'Genitive (Possession / “Of”)'],
  ['dative', 'Dative (The Indirect Object / After Certain Prepositions)'],
  ['accusative', 'Accusative (The Direct Object)'],
] as const;
export type CaseExample = { german: string; english: string; phrase: string; hint: string };
export type GrammarEntry = {
  word: string; note: string; proTip: string;
} & Record<typeof cases[number][0], CaseExample>;
const dictionary: Record<string, GrammarEntry> = examples;

export function grammarFor(front: string): GrammarEntry | undefined {
  const key = plainText(front);
  return Object.hasOwn(dictionary, key) ? dictionary[key] : undefined;
}

const LISTEN_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M3 10v4h4l5 5V5L7 10H3z"/><path d="M16.3 12c0-1.5-.8-2.8-2-3.4v6.8c1.2-.6 2-1.9 2-3.4z"/><path d="M14.3 4.6v2.1c2.3.8 4 3 4 5.3s-1.7 4.5-4 5.3v2.1c3.4-.9 6-4 6-7.4s-2.6-6.5-6-7.4z"/></svg>';

/**
 * Bundled text only, drafted but not yet linguistically reviewed. No network requests or
 * generated fallback lessons. `onPlay`, if given, adds a small listen button next to each
 * example sentence that hands the sentence text back to the caller (which already owns the
 * app's pronunciation settings and playback state) rather than importing pronounce() here.
 */
export function grammarPanel(front: string, onPlay?: (text: string) => void): HTMLElement | undefined {
  const entry = grammarFor(front);
  if (!entry) return undefined;
  const panel = document.createElement('section'); panel.className = 'grammar-examples';
  function text(parent: HTMLElement, tag: 'h2' | 'h3' | 'p', value: string, cls = '') {
    const node = document.createElement(tag); node.className = cls; node.textContent = value; parent.append(node); return node;
  }
  text(panel, 'h2', entry.word);
  text(panel, 'p', entry.note, 'grammar-note');
  for (const [key, title] of cases) {
    const example = entry[key];
    if (!example || !example.german || !example.english || !example.hint) continue; // skip a case that isn't available for this word
    const block = document.createElement('section'); block.className = 'grammar-case';
    text(block, 'h3', title);
    const row = document.createElement('div'); row.className = 'grammar-sentence-row';
    const sentence = document.createElement('p'); sentence.className = 'grammar-german';
    const start = example.german.indexOf(example.phrase);
    if (start >= 0 && example.phrase) {
      sentence.append(document.createTextNode(example.german.slice(0, start)));
      const emphasis = document.createElement('strong'); emphasis.textContent = example.phrase; sentence.append(emphasis);
      sentence.append(document.createTextNode(example.german.slice(start + example.phrase.length)));
    } else sentence.textContent = example.german;
    row.append(sentence);
    if (onPlay) {
      const listen = document.createElement('button');
      listen.type = 'button'; listen.className = 'grammar-listen'; listen.innerHTML = LISTEN_ICON;
      listen.setAttribute('aria-label', `Hear this example sentence: ${example.german}`);
      listen.addEventListener('pointerdown', e => e.stopPropagation());
      listen.addEventListener('click', e => { e.stopPropagation(); onPlay(example.german); });
      row.append(listen);
    }
    block.append(row);
    text(block, 'p', `(${example.english})`, 'grammar-english');
    text(block, 'p', `Hint: ${example.hint}`, 'grammar-hint');
    panel.append(block);
  }
  text(panel, 'h3', 'Pro-Tip');
  text(panel, 'p', entry.proTip, 'grammar-tip');
  return panel;
}
