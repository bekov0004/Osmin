#!/usr/bin/env bash
# Builds osmin@osmin.dev.shell-extension.zip: the extension with its service inside, for
# `gnome-extensions install --force <zip>` (or for uploading to extensions.gnome.org).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
gnome-extensions pack --force \
    --extra-source=src --extra-source=service --extra-source=LICENSE \
    --schema=schemas/org.gnome.shell.extensions.osmin.gschema.xml \
    --out-dir=. .
VERSION="$(grep -oP '"version-name":\s*"\K[^"]+' metadata.json)"
mv -f osmin@osmin.dev.shell-extension.zip "Osmin-$VERSION.zip"
echo "Built: Osmin-$VERSION.zip"
