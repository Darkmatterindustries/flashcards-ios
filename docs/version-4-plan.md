# Flashcards 4.0 implementation plan

> Superseded by [the case-example-only 4.0 scope](version-4-grammar.md). The earlier roadmap below is archived and is not authorized work for the current release.

## Baseline

All 4,388 existing pronunciation phrases have been generated and verified with Azure de-DE-KatjaNeural. The final 3.0 offline and Live IPAs have rebuilt successfully. At plan preparation, the Android/Windows refresh is still running; verify completion and preserve the finished 3.0 artifacts before replacing release outputs.

Keep the shared TypeScript app, Capacitor on iOS/Android, and the DPI-aware Windows WebView2 host. Preserve current study gestures, scheduled review, themes, offline decks, cloud backup and daily app-time history. No language rewrite is planned.

## Import menu

Tapping Import deck opens an accessible modal with three choices:

1. **Import from APKG** — existing offline importer and validation.
2. **Import from PDF (uses AI)** — online AI generation with review before saving.
3. **Create cards manually** — offline deck naming and front/back entry, with optional example sentences and tags.

Cancel closes the modal without changing the library. Keyboard focus, Android Back and touch interactions must work. APKG errors must leave existing decks intact. Manual drafts persist locally until saved or explicitly discarded; require nonempty front/back and at least one valid card to save.

## PDF flow

Choose PDF → inspect document and choose pages → configure generation → confirm processing → generate → preview/edit/select → save as a new deck or add to an existing deck.

The confirmation explains exactly what leaves the device, names the selected provider, states that internet is required, and shows the app's usage allowance before processing. Prefer local text extraction so only selected text and page references are sent. Do not upload an entire PDF when selected text is sufficient.

Generation options: deck name, target card count, source/answer languages, and card style (vocabulary or question/answer). Show progress, cancellation and actionable errors. Keep successful drafts after connectivity loss; avoid resubmitting the same generation request.

Every draft card shows editable front/back, optional example, selection toggle and source page reference. Allow select all, deselect, remove and duplicate review. Save only selected valid cards, atomically, without overwriting existing cards. Generated output remains a draft until the user confirms it.

Initial 4.0 scope: text-based PDFs. Detect scanned/image-only or password-protected PDFs and explain the limitation before any AI charge. OCR is a separately scoped enhancement, not silently promised. File/page/text/card limits must be enforced in both the app and backend; exact limits are set after extraction tests and provider cost measurements.

## Explain this word

Add an explicit action in study and card editing. Let the learner choose simple German or English. Produce structured fields: meaning, natural example sentence, grammar/usage and common mistakes where relevant. Include the existing card context to help distinguish meanings.

Show the explanation as AI-generated and editable. Let the user save it to the card or discard it. Saved explanations work offline and survive backup/restore. Reuse saved explanations; regenerate only after an explicit action. A general chatbot is outside the 4.0 scope.

## AI backend and cost controls

Choose a text-generation provider and hosting region before live AI integration. Azure Speech credentials cover pronunciation, not this text-generation feature. Keep model access behind an authenticated backend; no provider secret goes into JavaScript, APKs, IPAs or Windows files.

Use existing Firebase sign-in for AI access and verify tokens on the server. Enforce per-account quotas, rate/concurrency limits and a global spending ceiling server-side. Reserve allowance before expensive work; reconcile usage afterward. Persist job identifiers/results so retries do not create duplicate provider calls or duplicate saved decks. Cache word explanations by relevant input and language, with account isolation.

Validate structured responses, field sizes, number of cards and page references. Treat PDF contents as untrusted source text, never as instructions to the app. Render generated content safely. Do not log raw documents or secrets. Define temporary-data retention and deletion, and provide accurate privacy/support text before release.

Do not advertise unlimited AI with a one-time €4 purchase. Decide included allowance and behavior when exhausted before public rollout. Provider/model, pricing, hosting and retention remain decisions to resolve; this plan does not assume free AI credits.

## Data and cloud changes

Add backward-compatible optional card metadata for saved explanations and PDF source references. Preserve card IDs and schedules when editing; initialize new cards with fresh review state. Include new metadata in cloud upload/restore and test round trips with older decks.

Manual and accepted AI cards enter the same local storage and study flows as imported APKG cards. Unsaved drafts remain local. Existing cloud backup remains backup/restore rather than automatic deck merging; daily app-time sync retains its separate per-device behavior.

## Audio behavior

Bundle the verified Katja catalog in every platform release. New cards matching an existing normalized phrase reuse its recording offline. Words absent from the catalog use the available device voice and show that source. AI card generation does not automatically provide new Katja recordings. On-demand Katja generation, cost controls and download persistence would require separate implementation.

## Delivery order

1. Preserve and verify the completed audio release; establish versioned 4.0 output paths.
2. Build the import menu and manual creation/draft flow. Verify these offline on all platforms.
3. Add explanation/source metadata and cloud round-trip tests.
4. Configure authenticated AI backend, quotas and job handling; ship Explain this word behind a feature flag.
5. Add local PDF extraction and page selection, then generation and editable preview using the same backend.
6. Complete error/privacy copy, quota display, accessibility and physical-device checks. Build and verify 4.0 packages for iOS, Android and Windows.

## Acceptance checks

- Existing APKG imports and study gestures still work; cancelling a new flow never mutates a deck.
- Manual creation, saved explanations and bundled Katja playback work without internet.
- PDF processing sends only the content disclosed to the user; unsupported files fail before AI generation.
- AI output can be corrected or discarded; malformed or excessive output is rejected safely.
- Offline, timeout, quota-exhausted and duplicate-request paths neither lose drafts nor save duplicate cards.
- Usage limits and credentials are enforced on the server; accounts cannot access each other's jobs.
- Cloud restore preserves explanation metadata, examples, tags and study progress.
- Daily app-time history continues to persist and sync across updated devices.
- Test on physical iPhone/Android devices and Windows at different display scaling settings; browser tests alone do not certify native behavior.
- Keep the existing 3.0 release available until the 4.0 builds pass these checks.

This is an implementation plan. The 4.0 import menu, manual creation flow and AI features are not implemented yet.
