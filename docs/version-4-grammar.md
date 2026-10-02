# Version 4.0: case examples on card backs

This replaces the earlier import-menu, PDF and interactive-AI roadmap. The sole new feature is a bundled grammar lesson on the back of each existing vocabulary card. Existing study, cloud, appearance and Katja playback features remain.

Each lesson contains the word, an explanation of its word class, four case sections (German sentence, English translation, highlighted case phrase and specific hint), and a word-specific pro-tip. Verbs, adverbs, prepositions and fixed expressions must not be presented as having invented case forms. Their sentences demonstrate cases on actual noun/pronoun phrases while preserving the target's natural usage.

## Current implementation

- `src/grammar-examples.json` contains 220 validated entries (covering 248 source cards, Batches 001–011), with 0 structural errors.
- `scripts/grammar/promote-grammar-batches.mjs` promotes reviewed batches from `grammar-workspace/outputs/` directly into `src/grammar-examples.json`.
- `src/grammar.ts` resolves normalized existing card fronts. It renders the full 4-case grammar panel when available; missing words gracefully show the regular flashcard back without errors.
- `npm run grammar:check` (runs with `--progressive`) validates structure and highlights on all active lessons while tracking total progress toward the 4,388 catalog.

## Content preparation

The installed small local models did not pass the initial pilot. Qwen3.5 9B is being downloaded for a separate pilot. `scripts/grammar/pilot-local-grammar.mjs` writes drafts exclusively to `artifacts/grammar-pilot`; it never publishes model output into the app. No paid API credentials are needed for that local experiment. The model is a development tool and will not be bundled in the app.

Review pilot grammar, translations, naturalness and processing time before starting any large run. Retain original meanings when disambiguating vocabulary. Schema validation alone is insufficient; generated statements about cases must be checked against their actual sentences. General grammar references: [IDS adjective inflection](https://grammis.ids-mannheim.de/kontrastive-grammatik/3627) and [IDS prepositions](https://grammis.ids-mannheim.de/progr%40mm/5226).

## Release requirements

Finish and review the complete inventory, resolve ambiguous meanings, pass coverage plus application checks, then bump all platform versions and build separate 4.0 offline IPA, Live IPA, Android APK and Windows ZIP. Preserve the stable 3.0 artifacts. Do not describe the current development samples as a finished 4.0 release. Katja's 4,388 existing word recordings are retained; this scope does not promise new recordings of example sentences.
