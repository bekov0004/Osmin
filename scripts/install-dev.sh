#!/usr/bin/env bash
# Copies Osmin into your user directories: the GNOME Shell extension, its settings schema, and the
# Osmin service (the part that does the heavy work in a process of its own) with the D-Bus file that
# lets the extension start it. Run it from anywhere; it needs no root.
#   scripts/install-dev.sh            install / update
#   scripts/install-dev.sh --nested   ...then start a nested GNOME Shell with Osmin enabled
#   scripts/uninstall.sh              remove everything again
set -euo pipefail

UUID="osmin@bekov0004.github.io"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$DATA/gnome-shell/extensions/$UUID"

# The project used to be called Nook: take its leftovers away and bring its data (notes, tray,
# clipboard ...) and settings along. Nothing of the old name is kept running.
OLD_UUID="nook@bekov0004.github.io"
if [[ -d "$DATA/gnome-shell/extensions/$OLD_UUID" || -d "$DATA/nook" ]]; then
    gnome-extensions disable "$OLD_UUID" 2>/dev/null || true
    rm -rf "$DATA/gnome-shell/extensions/$OLD_UUID" "$DATA/nook-service" \
           "$DATA/dbus-1/services/io.github.bekov0004.Nook.service" "$DATA/applications/io.github.bekov0004.Nook.desktop"
    if [[ -d "$DATA/nook" && ! -e "$DATA/osmin" ]]; then
        mv "$DATA/nook" "$DATA/osmin"
        echo "Moved your data from $DATA/nook to $DATA/osmin"
    fi
    if command -v dconf >/dev/null && [[ -n "$(dconf list /org/gnome/shell/extensions/nook/ 2>/dev/null)" ]] &&
       [[ -z "$(dconf list /org/gnome/shell/extensions/osmin/ 2>/dev/null)" ]]; then
        dconf dump /org/gnome/shell/extensions/nook/ | dconf load /org/gnome/shell/extensions/osmin/ && echo "Copied your settings"
        # the one setting whose name had the old name in it
        old_shortcut="$(dconf read /org/gnome/shell/extensions/nook/shortcut-nook 2>/dev/null || true)"
        [[ -n "$old_shortcut" ]] && dconf write /org/gnome/shell/extensions/osmin/shortcut-osmin "$old_shortcut" || true
    fi
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$SRC/extension.js" "$SRC/prefs.js" "$SRC/metadata.json" "$SRC/stylesheet.css" \
      "$SRC/src" "$SRC/schemas" "$DEST/"
glib-compile-schemas "$DEST/schemas"
echo "Installed the extension to $DEST"

SERVICE_DEST="$DATA/osmin-service"
rm -rf "$SERVICE_DEST"
mkdir -p "$SERVICE_DEST" "$DATA/dbus-1/services"
cp -r "$SRC/service/." "$SERVICE_DEST/"
# What the service says goes to ~/.cache/osmin/service.log (it has no terminal of its own).
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/osmin"
mkdir -p "$CACHE"
[[ -f "$CACHE/service.log" && $(stat -c %s "$CACHE/service.log") -gt 204800 ]] && : > "$CACHE/service.log"
cat > "$DATA/dbus-1/services/io.github.bekov0004.Osmin.service" <<UNIT
[D-BUS Service]
Name=io.github.bekov0004.Osmin
Exec=/bin/sh -c "exec $(command -v gjs) -m $SERVICE_DEST/main.js 2>>$CACHE/service.log"
UNIT
mkdir -p "$DATA/applications"
cat > "$DATA/applications/io.github.bekov0004.Osmin.desktop" <<UNIT
[Desktop Entry]
Type=Application
Name=Osmin
Comment=Status of the Osmin service (the capsule is a GNOME Shell extension)
Icon=view-grid-symbolic
Exec=$(command -v gjs) -m $SERVICE_DEST/main.js
DBusActivatable=true
Categories=Utility;
UNIT
echo "Installed the service to $SERVICE_DEST"

if [[ "${1:-}" == "--nested" ]]; then
    exec dbus-run-session -- bash -c \
        "gnome-shell --devkit --wayland & sleep 6; gnome-extensions enable $UUID; wait"
fi
echo "Log out and in again (Wayland), then: gnome-extensions enable $UUID"
