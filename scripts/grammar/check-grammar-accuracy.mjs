// Deeper (still mechanical) accuracy sweep over grammar-workspace/outputs/*.md.
// Two independent checks, both gender-agnostic where the grammar itself is ambiguous
// (to keep false positives low) but precise wherever German grammar is NOT ambiguous:
//
// 1. Weak (n-declension) noun endings: known weak nouns must add -n/-en (or Name-type -ns)
//    outside the nominative singular.
// 2. Determiner/adjective ending agreement: after an article or der-/ein-word, the following
//    adjective must use the correct strong/weak/mixed ending for the stated case. Dative and
//    genitive weak/mixed endings are ALWAYS -en regardless of gender, so those checks are exact.
//    Nominative/accusative are checked only where German itself is unambiguous (e.g. a bare
//    ein-word is not ambiguous by case), and left alone where a single determiner form
//    (der/die "die", "eine"-plural-lookalikes) legitimately covers two valid endings.
//
// This is still not a linguistic review of meaning, naturalness or translation — only of
// mechanical case/ending agreement that can be checked without a full parser or dictionary.
import { readFile, readdir } from 'node:fs/promises';

const outputsDir = 'grammar-workspace/outputs';
const CASES = ['nominative', 'accusative', 'dative', 'genitive'];

// --- Check 1: weak (n-declension) nouns ------------------------------------------------
// nominative singular (lowercase) -> expected oblique singular (accusative/dative/genitive)
const WEAK_NOUNS = {
  mensch: 'menschen', student: 'studenten', junge: 'jungen', herr: 'herrn', kunde: 'kunden',
  kollege: 'kollegen', nachbar: 'nachbarn', experte: 'experten', präsident: 'präsidenten',
  polizist: 'polizisten', journalist: 'journalisten', tourist: 'touristen', spezialist: 'spezialisten',
  pilot: 'piloten', athlet: 'athleten', diplomat: 'diplomaten', soldat: 'soldaten',
  kandidat: 'kandidaten', automat: 'automaten', demokrat: 'demokraten', fotograf: 'fotografen',
  philosoph: 'philosophen', elefant: 'elefanten', produzent: 'produzenten', patient: 'patienten',
  klient: 'klienten', assistent: 'assistenten', prinz: 'prinzen', bär: 'bären', fürst: 'fürsten',
  graf: 'grafen', held: 'helden', narr: 'narren', name: 'namen', buchstabe: 'buchstaben',
  friede: 'frieden', gedanke: 'gedanken', glaube: 'glauben', wille: 'willen', funke: 'funken',
  same: 'samen', vorfahr: 'vorfahren', satellit: 'satelliten', planet: 'planeten', komet: 'kometen',
  architekt: 'architekten', christ: 'christen', biologe: 'biologen', psychologe: 'psychologen',
  ökonom: 'ökonomen', astronom: 'astronomen', dozent: 'dozenten', absolvent: 'absolventen',
  bürokrat: 'bürokraten', aristokrat: 'aristokraten', advokat: 'advokaten', idealist: 'idealisten',
  realist: 'realisten', optimist: 'optimisten', pessimist: 'pessimisten', terrorist: 'terroristen',
  löwe: 'löwen', hase: 'hasen', bote: 'boten', genosse: 'genossen', erbe: 'erben', neffe: 'neffen',
  zeuge: 'zeugen', bauer: 'bauern', fürsprecher: 'fürsprechern',
};
// Genitive singular of Name-type nouns adds -ns, not just -n.
const NAME_TYPE = new Set(['name', 'friede', 'glaube', 'wille']);

function extractLemma(word) {
  // "der Ruin, -" -> "Ruin"; "die Kenntnis, -se" -> "Kenntnis"; "dieser / diese / dieses" left alone.
  const commaIdx = word.indexOf(',');
  const base = commaIdx >= 0 ? word.slice(0, commaIdx) : word;
  const parts = base.trim().split(/\s+/);
  if (['der', 'die', 'das'].includes(parts[0]?.toLowerCase())) return parts.slice(1).join(' ');
  return null;
}

function checkWeakNoun(word, entry, problems) {
  const lemma = extractLemma(word);
  if (!lemma) return;
  const key = lemma.toLowerCase();
  const expectedOblique = WEAK_NOUNS[key];
  if (!expectedOblique) return;
  for (const c of ['accusative', 'dative', 'genitive']) {
    const phrase = entry[c]?.phrase;
    if (!phrase) continue;
    const words = phrase.split(/\s+/);
    // Find the token that is the noun itself (matches lemma case-insensitively, ignoring trailing punctuation).
    const bareRe = new RegExp(`\\b${lemma}\\b`, 'i');
    const hasBareForm = bareRe.test(phrase);
    let expected = expectedOblique;
    if (c === 'genitive' && NAME_TYPE.has(key)) expected = expectedOblique + 's'; // e.g. Namens
    const expectedRe = new RegExp(`\\b${expected}\\b`, 'i');
    const hasExpectedForm = expectedRe.test(phrase);
    if (hasBareForm && !hasExpectedForm) {
      problems.push({ type: 'weak-noun', word, case: c, phrase, detail: `expected "${lemma}" to appear as "${expected}" (weak/n-noun declension), found bare "${lemma}" instead` });
    }
  }
}

// --- Check 2: determiner/adjective ending agreement -------------------------------------
const PREPOSITIONS = new Set(['mit','ohne','nach','bei','von','zu','aus','außer','gegenüber','seit','an','auf','in','über','unter','vor','hinter','neben','zwischen','durch','für','gegen','um','wegen','trotz','während','innerhalb','außerhalb','statt','anstatt','laut','gemäß','dank','entlang','bis','ab','angesichts','aufgrund','oberhalb','unterhalb','jenseits','diesseits']);
// Fused preposition+article forms behave like a "suffixed" der-word trigger for this check.
const FUSED_DER_WORD = new Set(['im','am','beim','zum','vom','zur','ans','ins','aufs','durchs','übers','unters','hinters','vors']);
const DER_WORDS = new Set(['der','die','das','den','dem','des','dieser','diese','dieses','diesen','diesem','jener','jene','jenes','jenen','jenem','jeder','jede','jedes','jeden','jedem','mancher','manche','manches','manchen','manchem','solcher','solche','solches','solchen','solchem','welcher','welche','welches','welchen','welchem','aller','alle','alles','allen','allem','beide','beiden','beider','sämtliche','sämtlichen']);
const EIN_STEMS = ['ein','kein','mein','dein','sein','ihr','unser','euer','Ihr'.toLowerCase()];
const EIN_BARE = new Set(EIN_STEMS);
const EIN_SUFFIXED = new Set(EIN_STEMS.flatMap(s => ['e','en','em','er','es'].map(suf => s + suf)));
const ADVERB_SKIP = new Set(['sehr','ganz','wirklich','äußerst','ziemlich','besonders','ausgesprochen','überaus','ungewöhnlich','überraschend','erstaunlich','unglaublich','wahnsinnig','echt','total','komplett','völlig','vollkommen','zutiefst','außergewöhnlich','extrem','relativ','einigermaßen','recht','höchst','denkbar','geradezu','schlichtweg','nahezu','beinahe','fast','offensichtlich','buchstäblich','ungemein','durchaus','eher','etwas','irgendwie','allzu','ungeheuer']);

function endingOf(w) {
  const clean = w.toLowerCase().replace(/[.,!?;:]+$/, '');
  for (const suf of ['en', 'er', 'es', 'em', 'e']) if (clean.endsWith(suf)) return suf;
  return null;
}

function classifyDeterminer(tokenLower) {
  if (DER_WORDS.has(tokenLower) || FUSED_DER_WORD.has(tokenLower)) return 'der-word';
  if (EIN_BARE.has(tokenLower)) return 'ein-bare';
  if (EIN_SUFFIXED.has(tokenLower)) return 'ein-suffixed';
  return null;
}

// Returns {valid:Set, invalid:Set} of adjective endings for a given case + determiner class.
// Sets are gender-agnostic: 'valid' includes every ending that is correct under SOME gender
// reading, 'invalid' includes only endings that are wrong under EVERY gender reading.
function expectedEndings(grammCase, detClass, isNoDeterminer) {
  if (isNoDeterminer) {
    switch (grammCase) {
      case 'nominative': return { valid: new Set(['er','e','es']), invalid: new Set(['en','em']) };
      case 'accusative': return { valid: new Set(['en','e','es']), invalid: new Set(['er','em']) };
      case 'dative': return { valid: new Set(['em','er','en']), invalid: new Set(['e','es']) };
      case 'genitive': return { valid: new Set(['en','er']), invalid: new Set(['e','es','em']) };
    }
  }
  if (detClass === 'ein-bare') {
    switch (grammCase) {
      case 'nominative': return { valid: new Set(['er','es']), invalid: new Set(['e','en']) };
      case 'accusative': return { valid: new Set(['es']), invalid: new Set(['e','en','er']) };
      // ein-bare cannot occur in dative/genitive (all forms are suffixed there); treat as no-op.
      default: return null;
    }
  }
  // der-word or ein-suffixed: weak/mixed pattern.
  switch (grammCase) {
    case 'nominative': return { valid: new Set(['e','en']), invalid: new Set(['er','es','em']) };
    case 'accusative': return { valid: new Set(['e','en']), invalid: new Set(['er','es','em']) };
    case 'dative': return { valid: new Set(['en']), invalid: new Set(['e','er','es','em']) };
    case 'genitive': return { valid: new Set(['en']), invalid: new Set(['e','er','es','em']) };
  }
}

function checkAdjectiveAgreement(word, entry, problems) {
  for (const c of CASES) {
    const phrase = entry[c]?.phrase;
    if (!phrase) continue;
    const rawTokens = phrase.trim().split(/\s+/);
    if (rawTokens.length < 2) continue;
    let i = 0;
    let tokens = rawTokens.map(t => t.toLowerCase().replace(/[.,!?;:]+$/, ''));
    // Skip a single leading preposition.
    if (PREPOSITIONS.has(tokens[i])) i++;
    if (i >= tokens.length) continue;
    const detClass = classifyDeterminer(tokens[i]);
    const isNoDeterminer = detClass === null;
    // If no determiner, the first remaining token IS the (first) adjective candidate.
    let adjStart = isNoDeterminer ? i : i + 1;
    if (adjStart >= tokens.length - 0) continue; // need at least one more token after determiner/adj-start
    if (isNoDeterminer && adjStart >= tokens.length - 1) continue; // determiner-less needs adj + noun, i.e. >=2 tokens from here — a single bare noun phrase has nothing to check
    // Walk forward, skipping known invariant degree adverbs, to find the adjective closest to the noun.
    let adjIdx = -1;
    for (let k = adjStart; k < tokens.length - 1; k++) { // last token assumed to be the head noun
      if (ADVERB_SKIP.has(tokens[k])) continue;
      adjIdx = k;
      break;
    }
    if (adjIdx === -1) continue; // nothing but determiner + noun (+ skipped adverbs) — fine, nothing to check
    const ending = endingOf(rawTokens[adjIdx]);
    if (!ending) continue;
    const rule = expectedEndings(c, detClass, isNoDeterminer);
    if (!rule) continue;
    if (rule.invalid.has(ending)) {
      problems.push({ type: 'adjective-ending', word, case: c, phrase, detail: `adjective "${rawTokens[adjIdx]}" ends in -${ending}, which is not valid ${isNoDeterminer ? 'strong (no-determiner)' : detClass === 'ein-bare' ? 'strong-after-bare-ein-word' : 'weak/mixed'} declension for ${c}` });
    }
  }
}

// --- Run over every batch ----------------------------------------------------------------
const problems = [];
let entryCount = 0;
for (const file of (await readdir(outputsDir)).filter(f => f.endsWith('.md')).sort()) {
  const raw = await readFile(`${outputsDir}/${file}`, 'utf8');
  const match = raw.match(/```json\r?\n([\s\S]*?)```/);
  if (!match) continue;
  let data;
  try { data = JSON.parse(match[1]); } catch { continue; }
  for (const entry of data.entries) {
    entryCount++;
    checkWeakNoun(entry.word, entry, problems);
    checkAdjectiveAgreement(entry.word, entry, problems);
  }
}

console.log(`Checked ${entryCount} entries (${entryCount * 4} case phrases).`);
console.log(`${problems.length} potential issues flagged.\n`);
const byType = {};
for (const p of problems) (byType[p.type] ??= []).push(p);
for (const [type, list] of Object.entries(byType)) {
  console.log(`--- ${type}: ${list.length} ---`);
  for (const p of list) console.log(`  [${p.word}] ${p.case}: ${p.detail}\n    phrase: "${p.phrase}"`);
}
