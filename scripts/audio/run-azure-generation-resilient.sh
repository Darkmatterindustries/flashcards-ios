#!/bin/bash
# Keeps retrying scripts/audio/generate-azure-pronunciation.mjs across transient network drops.
# The underlying script deliberately does NOT retry on error, to avoid re-billing a paid tier
# — but this account is confirmed Azure Free (F0), so automatic retry here is safe: F0 cannot
# charge money, it only ever returns an error once its usage cap is hit. This wrapper only
# retries plain network-transport failures ("fetch failed"); if the script's own output ever
# shows a real Azure rejection ("Azure returned HTTP ..."), it stops immediately instead of
# looping, since that needs a human decision (quota exhausted, bad key, etc.), not a retry.
cd "C:/Users/maazl/Desktop/flashcard app ipa" || exit 1
INPUT="$1"
LOG="$TEMP/azure-generation-attempt.log"
MAX_ATTEMPTS=200
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "=== attempt $attempt/$MAX_ATTEMPTS ($(date -u +%Y-%m-%dT%H:%M:%SZ)) ==="
  node scripts/audio/generate-azure-pronunciation.mjs "$INPUT" --generate 2>&1 | tee "$LOG"
  status=${PIPESTATUS[0]}
  if [ "$status" -eq 0 ]; then
    echo "=== completed successfully ==="
    exit 0
  fi
  if grep -q "Azure returned HTTP" "$LOG"; then
    echo "=== stopping: this is a real Azure rejection, not a network blip — needs a look ==="
    exit 1
  fi
  echo "attempt $attempt failed (exit $status, transient); waiting 15s before retry..."
  sleep 15
done
echo "=== gave up after $MAX_ATTEMPTS attempts ==="
exit 1
