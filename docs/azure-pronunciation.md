# Azure German pronunciation

Create an Azure Speech resource in the Azure portal. Select the **F0 free** pricing tier if available. On the resource's **Keys and Endpoint** page, copy a key and the region into `.env.azure` on this computer. Never put keys in the app or chat. S0 is a paid tier; check the resource's pricing before generating.

The free neural speech allowance is 500,000 characters per month, subject to Azure's current terms and your resource's usage. We cannot read a remaining balance from this script.

First generate six short comparison clips:

```powershell
node scripts/audio/generate-azure-pronunciation.mjs --samples --generate
```

On the iPhone, open `http://192.168.0.197:5173/voice-samples/` while Live preview is running. Compare Katja and Conrad. Set `AZURE_SPEECH_VOICE` in `.env.azure` to the preferred name.

Check the missing audio count, then generate:

```powershell
node scripts/audio/generate-azure-pronunciation.mjs
node scripts/audio/generate-azure-pronunciation.mjs --generate
```

The default input is `artifacts/imported-pronunciation.txt`. Existing valid recordings from any provider are preserved. New clips are saved locally with progress after every phrase. Failed requests stop the run without automatic retries; rerunning reuses completed clips. Free-tier pacing means thousands of phrases can take hours. Generated audio is AI speech, not a recording of a human reading each word.

To explicitly replace existing voices, use `--replace-all`. Matching Azure files and voice samples are reused. The full Katja conversion can be resumed with `node scripts/audio/rebuild-katja-audio.mjs`; it reads `artifacts/katja-all-pronunciation.txt`, verifies every entry, and rebuilds both IPA files after successful generation. Progress is in `artifacts/azure-pronunciation-progress.json`, completion/failure in `artifacts/katja-rebuild-status.json`. Keep the computer awake and online until complete. The lock file prevents duplicate runs.

Live loads newly saved audio. Run the normal build and IPA packaging scripts to include it in the offline installation. Downloading or playing saved files uses no new provider credits.

References: [Azure Speech setup](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-text-to-speech), [REST API](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech), [pricing](https://azure.microsoft.com/en-gb/pricing/details/speech/).
