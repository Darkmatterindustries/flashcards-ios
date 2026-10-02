# Flashcards

iPhone flashcard MVP based on `docs/Flashcard_App_UX_UI.pdf`, with import-only deck management and three built-in German vocabulary cards. The UI is TypeScript/CSS, packaged as an iOS app with Capacitor and a local WKWebView. There is no account, server, analytics or runtime CDN dependency.

## Project layout

| Folder | Contents |
| --- | --- |
| `src/` | App code (TypeScript/CSS), grammar lessons and the pronunciation index |
| `public/pronunciation/` | Bundled Azure Katja voice clips for words and example sentences |
| `tests/`, `e2e/` | Vitest unit tests and Playwright end-to-end tests |
| `scripts/audio/` | Azure / ElevenLabs voice generation and audio summaries |
| `scripts/grammar/` | Grammar lesson drafting, validation and coverage checks |
| `scripts/decks/` | Builders for the curated Goethe C1 Anki decks |
| `scripts/packaging/` | iOS IPA, Android and Windows packaging, PlayCover signing |
| `grammar-workspace/` | Batch inputs/outputs used to draft the grammar lessons |
| `ios/`, `android/`, `windows/` | Native platform shells |
| `docs/` | Design spec, previews, release notes and test fixtures |

API keys live in git-ignored `.env.*` files and are never committed.

## Run and check

Use Node.js 24:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. This previews the app in a browser; it is not an IPA.

```sh
npm test
npx playwright install chromium webkit
npm run test:e2e
npm run build
```

The browser tests use a 440 × 956 viewport for the iPhone 16 Pro Max layout. Actual iOS device testing and Xcode compilation require a Mac and have not been performed on this Windows workspace.

## Study behavior

- Tap any deck tile to start a new session immediately.
- Tap the card to flip front/back. No visible study action buttons, aside from one small pronunciation icon (see below).
- Swipe left: append the current card to the queue.
- Swipe right: permanently move the card into a paired "‹Deck› — Memorized" deck (created on first use). Studying that companion deck itself uses the original session-only swipe-right behavior, so memorized cards aren't relocated a second time.
- Swipe down at the top of the card content: return to the library (approved addition to the PDF).
- Removing the last card opens a completion screen. Starting again restores all remaining cards.
- The quiet counter is the original card number / total deck size for this session. This stays meaningful when the queue repeats or shrinks.
- Library progress counts distinct cards swiped at least once. It is saved across sessions; it is not an Anki scheduling score.
- A small speaker icon on the card speaks the German front text aloud via the Web Speech API (`de-DE`), which uses whichever system voice — including an Enhanced/Premium voice — the user has installed for German. It works for every deck, not just imported audio.
- Long content scrolls vertically inside the card. Scroll to the top before swiping down to leave.
- Keyboard equivalents and visually hidden assistive actions are available; reduced motion is respected.
- A toast with an **Undo** button appears after each swipe (except the one that finishes a deck) for about 4 seconds, or until the next swipe. Undo puts the card back at the front of the queue, drops its reviewed mark, and pulls it back out of the Memorized deck if it had just been moved there. Cmd/Ctrl+Z does the same.
- Leaving a deck mid-session (swipe down, or just closing the app) saves the exact remaining queue. Reopening that deck resumes it instead of restarting; finishing a deck, or "Study again" from the completion screen, always starts fresh.

## Home screen navigation

A bottom bar on the library screen only (not shown during study, to keep the card view distraction-free) has three tabs:

- **Feedback** — opens a short note field and hands it to the Mail app via a `mailto:` link.
- **Home** — the library itself; shown as the active tab.
- **Settings** — pick a German pronunciation voice (when more than one is installed) and speaking speed, switch between Automatic/Light/Dark appearance, reset study progress, delete all decks, and see the app version.

Reset and delete actions require a second tap within 3 seconds to confirm before anything changes.

## Deck management

- A search box above the deck list filters by name as you type.
- Each deck tile has a shuffle icon (toggles that deck between original import order and random order for its next fresh session; remembered per deck) and a "⋯" menu (Rename, Delete, Cancel). Deleting a deck also removes its Memorized companion and any media no other deck still uses.

## Cloud backup (optional)

Sign in from **Settings → Account & backup** with an email and password to back up your decks and progress, and restore them after reinstalling (the 7-day Sideloadly re-signing cycle wipes local storage each time). Backed up: deck names, cards, reviewed/memorized status, and app settings. Not backed up: bundled images/audio from an `.apkg` import — those stay device-local, so re-import the original package after restoring a deck that had media.

Sync happens automatically after every visit to the library screen, and when the app is backgrounded, whenever you're signed in; there's also a manual **Sync now** button. Signing in on a device that already has its own decks (not just the untouched starter deck) asks you to choose the cloud backup or this device's copy — there's no merge.

This needs a Firebase project (Authentication with Email/Password, and Firestore) configured in `src/firebase-config.ts`. Without a config filled in, this section just shows "Cloud backup isn't set up yet" and the rest of the app is unaffected.

## APKG import

Choose **Import deck** in the library and select an `.apkg` file in Files. After parsing, an **Import preview** screen lists every deck name and card count in the package plus any compatibility notes (skipped templates, unsupported media, etc.) before anything is saved — Import to commit it, or Cancel to discard it. Import runs in a background worker, and decks/media are saved together in IndexedDB. Removing the app removes its local data.

Supported package containers:

- `collection.anki2` and `collection.anki21` SQLite collections with legacy JSON note types.
- `collection.anki21b` Zstandard collections with protobuf note types/media maps.
- Basic, reversed and standard cloze templates, named fields and conditional sections.
- Bundled PNG/JPEG/GIF/WebP/AVIF images and common audio files. Audio playback depends on WebKit codec/autoplay support.
- Multiple decks and subdeck names, with exact-package duplicate detection.

Limits: 100 MB package, 300 MB expanded content, 50,000 cards, 60-second parse timeout. Re-exporting a changed package imports a separate copy; this MVP does not merge updates or sync Anki scheduling. Imported formatting is normalized to the PDF's typography. Custom CSS, scripts, image occlusion, unsupported template filters, SVG media and interactive Anki add-ons are not implemented. Unsupported templates are skipped with a visible import report; a package with no supported cards is rejected. Keep the original APKG as your backup.

`docs/test-import-legacy.apkg` and `docs/test-import-modern.apkg` are small synthetic parser fixtures for testing this app's importer, containing basic, reversed, cloze and image examples. They are not full Anki collection backups.

## Build for iPhone

The native project is `ios/App/App.xcodeproj`; it uses Swift Package Manager. The bundle ID is `com.maaz.flashcards`, with a portrait iPhone target and a light interface.

On a Mac with Xcode 26 or newer:

```sh
npm ci
npm run ios:sync
npm run ios:open
```

In Xcode, select the **App** target, choose your signing team under **Signing & Capabilities**, connect your iPhone, select it as the run destination, and run. For an installable IPA, archive and export using a signing method/provisioning profile that includes your device.

A manually triggered GitHub Actions workflow is prepared in `.github/workflows/ios-build.yml` for a future Mac build. It has not been uploaded or run. Its output is explicitly **unsigned** and must be signed before it can be installed. No IPA has been produced in this workspace.

References: [Capacitor iOS requirements](https://capacitorjs.com/docs/ios), [Anki package metadata](https://github.com/ankitects/anki/blob/main/proto/anki/import_export.proto), [Anki note type metadata](https://github.com/ankitects/anki/blob/main/proto/anki/notetypes.proto).
