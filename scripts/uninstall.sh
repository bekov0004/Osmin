#!/usr/bin/env bash
# Removes what scripts/install.sh installed. Your data (~/.local/share/osmin: notes, tray, clipboard,
# ...) and settings are left alone.
set -euo pipefail

DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
gnome-extensions disable osmin@osmin.dev 2>/dev/null || true
gnome-extensions disable osmin@bekov0004.github.io 2>/dev/null || true
rm -rf "$DATA/gnome-shell/extensions/osmin@osmin.dev" "$DATA/applications/dev.osmin.Osmin.desktop" \
       "$DATA/gnome-shell/extensions/osmin@bekov0004.github.io" "$DATA/applications/io.github.bekov0004.Osmin.desktop" \
       "$DATA/osmin-service" "$DATA/dbus-1/services/io.github.bekov0004.Osmin.service"
# (and the leftovers of the old name)
rm -rf "$DATA/gnome-shell/extensions/nook@bekov0004.github.io" "$DATA/nook-service" \
       "$DATA/dbus-1/services/io.github.bekov0004.Nook.service" "$DATA/applications/io.github.bekov0004.Nook.desktop"
echo "Osmin is removed (your data in $DATA/osmin is kept)."
