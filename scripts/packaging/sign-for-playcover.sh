#!/bin/bash
# Run this on a Mac (codesign is macOS-only). Adds a local ad-hoc signature to an
# unsigned IPA so PlayCover accepts it. Ad-hoc signing needs no Apple account or
# certificate — it just satisfies the "must have some signature" check.
#
# Usage: ./scripts/packaging/sign-for-playcover.sh path/to/Flashcards-4.0-unsigned.ipa
set -euo pipefail

IPA_ARG="${1:?Usage: sign-for-playcover.sh path/to/unsigned.ipa}"
if [ ! -f "$IPA_ARG" ]; then
  echo "File not found: $IPA_ARG" >&2
  exit 1
fi
IPA="$(cd "$(dirname "$IPA_ARG")" && pwd)/$(basename "$IPA_ARG")"
OUT="${IPA%.ipa}-adhoc.ipa"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Extracting $IPA..."
unzip -q "$IPA" -d "$WORK"

APP_DIR=$(find "$WORK/Payload" -maxdepth 1 -name '*.app' | head -n1)
if [ -z "$APP_DIR" ]; then
  echo "Could not find a .app bundle inside Payload/" >&2
  exit 1
fi

echo "Signing $(basename "$APP_DIR") ad-hoc..."
codesign --force --deep --sign - "$APP_DIR"

echo "Repackaging as $OUT..."
rm -f "$OUT"
(cd "$WORK" && zip -qr "$OUT" Payload)

echo "Done: $OUT"
echo "Drag this file into PlayCover."
