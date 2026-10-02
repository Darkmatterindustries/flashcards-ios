// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cases, grammarFor, grammarPanel } from '../src/grammar';
import examples from '../src/grammar-examples.json';

it('finds existing cards with HTML fronts and renders all four translated cases', () => {
  const panel = grammarPanel('der<br>Entwurf')!;
  expect(panel.querySelectorAll('.grammar-case')).toHaveLength(4);
  expect(panel.querySelectorAll('.grammar-english')).toHaveLength(4);
  expect(panel.querySelectorAll('.grammar-hint')).toHaveLength(4);
  expect(panel.textContent).toContain('Pro-Tip');
  expect(panel.querySelector('strong')?.textContent).toBe('Der Entwurf');
});

it('never substitutes an unrelated lesson for missing vocabulary', () => {
  expect(grammarFor('unknown word')).toBeUndefined();
  expect(grammarPanel('constructor')).toBeUndefined();
});

it('distinguishes verb usage from noun declension', () => {
  expect(grammarFor('verstehen')?.note).toContain('Verbs conjugate');
  expect(grammarFor('verstehen')?.genitive.hint).toContain('does not require a genitive object');
});

it('requires complete examples and a highlighted phrase present in each sentence', () => {
  for (const entry of Object.values(examples)) {
    expect(entry.word.trim()).not.toBe('');
    expect(entry.note.trim()).not.toBe('');
    expect(entry.proTip.trim()).not.toBe('');
    for (const [key] of cases) {
      const example = entry[key];
      for (const value of Object.values(example)) expect(value.trim()).not.toBe('');
      expect(example.german).toContain(example.phrase);
    }
  }
});
