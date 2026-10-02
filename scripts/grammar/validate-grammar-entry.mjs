/** Structural rejection only. Passing this does not establish linguistic accuracy. */
export function validateGrammarEntry(entry, expectedWord) {
  const errors = [];
  const cases = ['nominative', 'accusative', 'dative', 'genitive'];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['Expected an object'];
  if (entry.word !== expectedWord) errors.push('Word does not match the requested entry');
  const checkText = (value, label, max) => {
    if (typeof value !== 'string' || !value.trim()) { errors.push(`${label}: missing text`); return; }
    if (value.length > max) errors.push(`${label}: excessive length`);
    if (/\b(?:let me|let's|wait,|the prompt|the instruction|re-evaluate|corrected sentence|new sentence|i will|we must|we will)\b/i.test(value)) errors.push(`${label}: unfinished drafting commentary`);
  };
  checkText(entry.note, 'note', 600);
  checkText(entry.proTip, 'proTip', 500);
  for (const name of cases) {
    const part = entry[name];
    if (!part || typeof part !== 'object') { errors.push(`${name}: missing case`); continue; }
    checkText(part.german, `${name}.german`, 250);
    checkText(part.english, `${name}.english`, 300);
    checkText(part.hint, `${name}.hint`, 600);
    checkText(part.phrase, `${name}.phrase`, 150);
    if (typeof part.german === 'string' && typeof part.phrase === 'string' && !part.german.includes(part.phrase)) errors.push(`${name}: phrase absent from sentence`);
  }
  return errors;
}
