# Flashcards 3.0

The existing Quick Review remains the default when tapping a deck: tap to flip,
left to repeat, right to move to Memorized, down to return. Undo and session resume
remain available. Quick Review now counts toward the daily activity goal.

Home has due/new counts, a daily review goal and seven days of activity. **Study hub**
opens optional scheduled, difficult-word, reverse and listening modes, card editing,
and audio downloads. Each deck's menu also opens the hub with that deck selected.

Scheduled review uses a simple interval scheduler, not FSRS: Again schedules one
minute later; Hard, Good and Easy grow the interval shown on their buttons. Sessions
offer due cards first, then at most 20 new cards. Memorized decks are excluded.
Scheduled ratings never move cards. Activity tracks review attempts, not unique words.

The editor supports front/back text, examples, comma-separated tags and a difficult
flag. Unchanged fields retain their original HTML/media. Edited text fields become
escaped plain text. Changing German text can invalidate a generated audio match.

Download available audio saves existing MP3s to IndexedDB on this device, deduplicated
by filename. Interrupted downloads retain completed files. The live preview still
requires the computer to open the app; the offline IPA bundles all available generated
audio and application assets. No additional ElevenLabs credits are spent on downloads.
The latest provider check returned zero credits; 2,777 imported phrases remain without
generated audio and use the system voice.

Backup includes the new card fields, activity, goal and preferences. Saved status shows
last success/error and pending local changes, and restore offers a preview before
replacing a nonempty library. Card order is now preserved in new cloud backups; cards
moved out of a deck are removed from that deck's cloud copy. Unchanged documents are
not rewritten. Backup is not live multi-device merging, and media/downloaded audio are
not uploaded. Use Sync now while connected before moving to another installation.

Run `npm.cmd run build` and `npm.cmd test`. Browser checks are in `e2e/v3.spec.ts` and
the existing regression suite. Chromium checks cover original gestures, review ratings,
editing and downloaded audio. WebKit could not launch on this Windows environment;
physical iPhone installation and playback still need device verification.

`scripts/packaging/package-offline-ipa.py` puts `dist` into the existing unsigned native shell
and sets version 3.0/build 3. It does not compile native code. The generated
`artifacts/Flashcards-3.0-unsigned.ipa` must be signed using Sideloadly before installing.
