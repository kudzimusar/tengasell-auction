#!/usr/bin/env bash
# REL-002 — apply release signing to the generated Android project.
#
# `expo prebuild` regenerates android/ and resets signing to the debug keystore.
# Run this after any prebuild, before `bundleRelease`:
#
#   bash scripts/apply-release-signing.sh
#
# Credentials come from the environment or ~/.tengasell/secrets.env:
#   TGS_KEYSTORE_FILE, TGS_KEYSTORE_PASSWORD, TGS_KEY_ALIAS
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f "$HOME/.tengasell/secrets.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$HOME/.tengasell/secrets.env"
  set +a
fi

: "${TGS_KEYSTORE_FILE:?TGS_KEYSTORE_FILE is not set}"
: "${TGS_KEYSTORE_PASSWORD:?TGS_KEYSTORE_PASSWORD is not set}"
: "${TGS_KEY_ALIAS:=tengasell}"

GRADLE="android/app/build.gradle"
[ -f "$GRADLE" ] || { echo "run 'npx expo prebuild --platform android' first" >&2; exit 1; }

GRADLE="$GRADLE" python3 - <<'PY'
import os, pathlib

path = pathlib.Path(os.environ["GRADLE"])
src = path.read_text()

SIGNING = '''    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            // REL-002 - release signing from the custodied keystore.
            storeFile file(System.getenv("TGS_KEYSTORE_FILE"))
            storePassword System.getenv("TGS_KEYSTORE_PASSWORD")
            keyAlias System.getenv("TGS_KEY_ALIAS") ?: "tengasell"
            keyPassword System.getenv("TGS_KEYSTORE_PASSWORD")
        }
    }
'''

BUILD_TYPES = '''    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.release
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
            shrinkResources enableShrinkResources.toBoolean()
            minifyEnabled enableMinifyInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"
            def enablePngCrunchInRelease = findProperty('android.enablePngCrunchInReleaseBuilds') ?: 'true'
            crunchPngs enablePngCrunchInRelease.toBoolean()
        }
    }
'''


def replace_block(text: str, header: str, replacement: str) -> str:
    start = text.index(header)
    i = start + len(header)
    depth = 1
    while depth:
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        i += 1
    end = text.index("\n", i) + 1
    return text[:start] + replacement + text[end:]


for header, block in (("    signingConfigs {", SIGNING), ("    buildTypes {", BUILD_TYPES)):
    if header in src:
        src = replace_block(src, header, block)

path.write_text(src)
print("release signing applied:", path)
PY

grep -n "signingConfigs.release\|TGS_KEYSTORE" "$GRADLE" | head -6
