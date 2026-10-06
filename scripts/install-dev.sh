#!/usr/bin/env bash
# Copies Osmin into your user extensions directory and compiles its settings
# schema. Run it from anywhere; it needs no root.
#   scripts/install-dev.sh            install / update
#   scripts/install-dev.sh --nested   ...then start a nested GNOME Shell with Osmin enabled
set -euo pipefail

UUID="osmin@bekov0004.github.io"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$SRC/extension.js" "$SRC/prefs.js" "$SRC/metadata.json" "$SRC/stylesheet.css" \
      "$SRC/src" "$SRC/schemas" "$DEST/"
glib-compile-schemas "$DEST/schemas"
echo "Installed to $DEST"

if [[ "${1:-}" == "--nested" ]]; then
    exec dbus-run-session -- bash -c \
        "gnome-shell --devkit --wayland & sleep 6; gnome-extensions enable $UUID; wait"
fi
echo "Log out and in again (Wayland), then: gnome-extensions enable $UUID"
