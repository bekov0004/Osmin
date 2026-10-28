#!/usr/bin/env bash
# Removes what scripts/install-dev.sh installed: the extension, the Osmin service and its D-Bus file.
# Your data (~/.local/share/osmin: notes, tray, clipboard, ...) is left alone.
set -euo pipefail

DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
gnome-extensions disable osmin@bekov0004.github.io 2>/dev/null || true
rm -rf "$DATA/gnome-shell/extensions/osmin@bekov0004.github.io" \
       "$DATA/osmin-service" \
       "$DATA/dbus-1/services/io.github.bekov0004.Osmin.service" \
       "$DATA/applications/io.github.bekov0004.Osmin.desktop"
echo "Osmin is removed (your data in $DATA/osmin is kept)."
