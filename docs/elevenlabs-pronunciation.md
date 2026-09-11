# Saved German pronunciation

Create `.env.elevenlabs` in the project root with:

```dotenv
ELEVENLABS_API_KEY=paste_your_key_here
ELEVENLABS_VOICE_ID=your_voice_id
```

This file is ignored by Git and blocked by Vite's default `.env` file restrictions.
Do not put the key in `src`, `public`, a `VITE_` variable, or chat.
Use an ElevenLabs key with text-to-speech access and voice-read access if listing voices.

List your voices and choose a German voice:

```powershell
node scripts/generate-pronunciation.mjs --voices
```

Preview the work without generating or spending credits:

```powershell
node scripts/generate-pronunciation.mjs docs/pronunciation-sample.txt
```

Generate the three starter-card samples:

```powershell
node scripts/generate-pronunciation.mjs docs/pronunciation-sample.txt --generate
```

Open the starter deck in Flashcards Live and tap the speaker. Settings also has a
Test voice button for “der Entwurf”. Once the voice sounds right, pass a UTF-8 text
file with one German word or phrase per line to generate the full vocabulary.
Input text is sent to ElevenLabs. Generation uses your account's credits; replay
does not make provider requests. The script deduplicates phrases and reuses files
for the same text, voice, and model. Interrupted runs retain completed clips.

To cover the imported decks in this workspace, export their spoken card fronts
using the app's own APKG parser and text normalization, then generate:

```powershell
node scripts/export-pronunciation.mjs flashcarddecks/German_C1_Vocabulary.apkg flashcarddecks/Goethe_C1_Vocabulary.apkg
node scripts/generate-pronunciation.mjs artifacts/imported-pronunciation.txt
node scripts/generate-pronunciation.mjs artifacts/imported-pronunciation.txt --generate
```

The exporter reads local files; it does not change the phone or cloud backup.
Generation uses two concurrent requests and publishes completed clips every 25
phrases, plus at completion or provider failure. If credits run out, run the same
command after credits become available to resume. Previously saved matching clips
are reused. Words from later imports need another export/generation pass.

Generated MP3s live in `public/pronunciation`, with a manifest in
`src/pronunciation-recordings.json`. The normal IPA bundles these for offline use.
The development IPA loads them from your computer and still needs the preview server.
New or ungenerated phrases use the device voice. Changing the saved-audio switch
lets you compare that voice with the generated audio.

References: [Speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert),
[API authentication](https://elevenlabs.io/docs/api-reference/authentication).
