#!/usr/bin/env bash
# Builds the Osmin Phone app (android/) and copies the apk to dist/osmin-phone.apk.
#   scripts/build-android.sh            builds the debug apk (signed with the debug key)
#   scripts/build-android.sh test       runs the unit tests of the phone-side server
#   scripts/build-android.sh install    builds and installs it on the phone adb is connected to
# Needs the Android SDK (ANDROID_HOME, default /opt/android-sdk) and a JDK 17.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../android"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
[[ -f local.properties ]] || echo "sdk.dir=$ANDROID_HOME" > local.properties
case "${1:-build}" in
    test)
        ./gradlew testDebugUnitTest
        ;;
    build|install)
        ./gradlew assembleDebug
        mkdir -p ../dist
        cp app/build/outputs/apk/debug/app-debug.apk ../dist/osmin-phone.apk
        echo "Built dist/osmin-phone.apk"
        if [[ "$1" == "install" ]]; then
            adb install -r ../dist/osmin-phone.apk
        fi
        ;;
    *)
        echo "usage: $0 [build|test|install]" >&2
        exit 2
        ;;
esac
