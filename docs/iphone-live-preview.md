# iPhone live preview

The separate **Flashcards Live** IPA loads this workspace from a Vite development
server over your private Wi-Fi. UI and JavaScript edits reload automatically.
The computer must stay awake and the server must remain running. Native plugin
or Swift changes require a newly compiled IPA; the preview does not bypass signing.

Start the server in this repository:

```powershell
npm.cmd run dev:iphone
```

Use `ipconfig` to find the Wi-Fi adapter's IPv4 address. Open
`http://YOUR-IP:5173` in iPhone Safari first to check connectivity.
If Windows asks, allow Node.js on your private network. Do not expose the development
server through your router or use it on public Wi-Fi.

Prepare the preview from an existing unsigned native build (Python 3):

```powershell
python scripts/prepare-live-ipa.py http://YOUR-IP:5173
```

Drag `artifacts/Flashcards-Live-unsigned.ipa` into Sideloadly and sign/install it.
Keep the preview bundle ID `com.maaz.flashcards.live` distinct from the regular app.
Allow Local Network access when iOS prompts, then open **Flashcards Live**.
The original IPA and native project remain unchanged.

Preview storage is separate from the regular app, and Safari has its own storage
too. Import a deck for testing. If using cloud backup, remember that the preview
uses the same configured Firebase project: signing in and syncing can affect that
account's backup. A change to the computer IP or port changes the preview storage
origin; a router DHCP reservation can keep the address stable.

If the computer IP changes, regenerate and reinstall the preview IPA with the new
address. If Safari cannot connect, check the server, firewall, Wi-Fi client isolation,
and VPN routing. If Safari connects but the app cannot, check iOS Settings > Privacy
& Security > Local Network and enable Flashcards Live.

Deck import includes a SHA-256 fallback because local HTTP lacks SubtleCrypto.
This keeps package IDs identical to the normal offline build.

The script modifies resource files and preserves ZIP metadata and executable bytes.
Its result is unsigned and requires a device installation check after Sideloadly
signing. Future offline releases use the regular build workflow, without a server URL.
