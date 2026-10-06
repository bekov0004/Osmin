# Osmin

A Dynamic Island-style panel for GNOME Shell 50. It sits at the top
center of the primary monitor, just under the top bar. It is a small dot at rest,
peeks on hover, and expands on click.

## Features (MVP)

- **Closed** – a tiny dark pill with a dot.
- **Hover** – grows smoothly and shows "Osmin".
- **Click** – expands to show the date/time, the active workspace, a close
  button and a "Test notification" button.
- **Test notification** – shows `✓ Test notification`, then collapses on its own after 3 s.
- Spring/easing animations; they follow the GNOME "enable animations" setting.
- Wayland-native (only Clutter/St/Mutter APIs, no X11 calls), HiDPI-aware.
- The island is hidden over fullscreen windows. Only its own area takes input,
  so windows underneath are unaffected.

## Requirements

- GNOME Shell 50 (Ubuntu 26.04), Wayland session
- No root, no extra packages, no changes to GNOME settings

## Install

```bash
git clone https://github.com/bekov0004/Osmin.git
cd Osmin
mkdir -p ~/.local/share/gnome-shell/extensions
ln -sfn "$PWD" ~/.local/share/gnome-shell/extensions/osmin@bekov0004.github.io
```

Log out and back in (Wayland cannot restart the shell in place), then:

```bash
gnome-extensions enable osmin@bekov0004.github.io
```

To copy instead of symlink: `gnome-extensions pack` and `gnome-extensions install Osmin.shell-extension.zip`.

## Uninstall

```bash
gnome-extensions disable osmin@bekov0004.github.io
rm ~/.local/share/gnome-shell/extensions/osmin@bekov0004.github.io
```

## Development

Wayland cannot reload the shell, so there are two options:

- **Nested shell (recommended).** Starts a separate GNOME Shell in a window
  and loads the current code from disk (this is how Osmin was tested, in
  `--headless` mode):

  ```bash
  dbus-run-session -- gnome-shell --devkit --wayland
  ```

  Enable the extension inside it with
  `gnome-extensions enable osmin@bekov0004.github.io`.
- **Disable/enable cycle** for `disable()`/`enable()` leaks checks:
  `gnome-extensions disable osmin@bekov0004.github.io && gnome-extensions enable osmin@bekov0004.github.io`.
  This does **not** re-read changed JS files; GJS caches modules until the shell restarts.

Logs:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Constants (sizes, durations, delays, gap under the top bar) live in
`src/utils/constants.js`; colors and radii live in `stylesheet.css`.

## Project structure

```
metadata.json            extension metadata (uuid, shell-version: 50)
extension.js             entry point: enable()/disable()
stylesheet.css           all styling
src/
  osmin.js                the island: actor, state machine, animations
  services/
    monitorService.js    target monitor + top-bar offset, monitors-changed
    clockService.js      1 s ticker, runs only while the island is open
    workspaceService.js  active workspace index / count
  widgets/
    closedView.js  hoverView.js  openView.js  notificationView.js
    clockWidget.js  workspaceWidget.js  button.js
  utils/
    constants.js  animation.js  scale.js  signals.js  timers.js
```

## Ideas for next steps

Real notifications from GNOME, media controls (MPRIS), battery/network/volume
indicators, per-monitor following of the focused window, a preferences window
(size, position, hover delay), and keyboard shortcuts.
