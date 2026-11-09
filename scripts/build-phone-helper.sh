#!/usr/bin/env bash
# Builds phone-helper/osmin-input.jar from phone-helper/src (Android SDK: javac, d8, android.jar).
# The jar is committed, so only people who change the helper need this.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/opt/android-sdk}}"
PLATFORM="$(ls -d "$SDK"/platforms/android-* | sort -V | tail -1)"
D8="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)/d8"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
javac --release 8 -cp "$PLATFORM/android.jar" -d "$TMP/classes" phone-helper/src/dev/osmin/Input.java
"$D8" --min-api 26 --lib "$PLATFORM/android.jar" --output "$TMP/out.jar" "$TMP"/classes/dev/osmin/*.class
cp "$TMP/out.jar" phone-helper/osmin-input.jar
echo "Built phone-helper/osmin-input.jar"
