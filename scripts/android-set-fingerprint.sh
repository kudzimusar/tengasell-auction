#!/usr/bin/env bash
# Writes the Play App Signing SHA-256 fingerprint into public/.well-known/assetlinks.json
#
# Usage:
#   bash scripts/android-set-fingerprint.sh <sha256-fingerprint>
# or, straight from a keystore:
#   bash scripts/android-set-fingerprint.sh --keystore android.keystore --alias tengasell
set -euo pipefail

FILE="public/.well-known/assetlinks.json"

if [ "${1:-}" = "--keystore" ]; then
  KS="$2"; ALIAS="$4"
  FP=$(keytool -list -v -keystore "$KS" -alias "$ALIAS" 2>/dev/null \
        | awk -F': ' '/SHA256:/{print $2; exit}')
  [ -n "$FP" ] || { echo "could not read fingerprint from $KS" >&2; exit 1; }
else
  FP="${1:?usage: $0 <sha256-fingerprint> | --keystore <ks> --alias <alias>}"
fi

python3 - "$FP" <<'PY'
import json, sys, pathlib
fp = sys.argv[1].strip()
p = pathlib.Path("public/.well-known/assetlinks.json")
data = json.loads(p.read_text())
data[0]["target"]["sha256_cert_fingerprints"] = [fp]
p.write_text(json.dumps(data, indent=2) + "\n")
print("assetlinks.json ->", fp)
PY
echo "Reminder: this file must be served at https://<domain>/.well-known/assetlinks.json"
