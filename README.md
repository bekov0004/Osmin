# Osmin

A Dynamic Island-style capsule for GNOME Shell 50 that **replaces the GNOME
clock** in the middle of the top bar. At rest it shows the time (or what is going on: a timer,
the music, a meeting); on hover or click the same capsule grows into a wide panel with widgets.

Everything runs inside GNOME Shell (GJS): no Electron, no helper app, no root, no system files
are touched, and disabling the extension brings the stock clock back.

## Features

- **Media** – any MPRIS player (Spotify, browsers, VLC, Rhythmbox, ...): artwork, title, artist,
  progress (click to seek), previous / play-pause / next.
- **Calendar** – month grid, event dots, upcoming events and a per-day agenda, from the system
  calendars (the same `org.gnome.Shell.CalendarServer` service the GNOME calendar uses).
- **Files** – a shelf: drag files from any app and release them over the capsule. Files are
  referenced, never copied or moved; the shelf is persistent, shows thumbnails, and lets you open
  a file, show it in the file manager, copy it to the clipboard, or remove it.
- **Mirror** – webcam preview (GStreamer: PipeWire, then `/dev/video0`). The camera is opened only
  when you press *Turn on* and released when you close the preview, change page or close the capsule.
  Nothing is recorded or saved.
- **Timer** – set, start, pause, resume, reset; survives suspend and restarts.
- **To-do** – a local task list (`~/.local/share/osmin/todo.json`).
- **Live Activities** – a running timer, music, or a meeting within 10 minutes takes the place of
  the time in the collapsed capsule; track changes, meetings, a finished timer and added files pop
  out as short cards. Clicking a card opens its widget.
- **Gestures** – hover swells the capsule and, if you rest, opens it; click opens at once;
  mouse wheel / two-finger swipe switches pages (one step per gesture); middle click on the
  collapsed capsule flips between ongoing activities; drag & drop files onto it.
- **Appearance** (GNOME Extensions preferences) – panel size, corner radius, opacity, animation
  speed, open on hover, collapse on leave, activities in the collapsed capsule, and which
  widgets are enabled.

`Super+V` (the "toggle calendar" shortcut) toggles Osmin instead of the hidden calendar popup.

## Requirements

- GNOME Shell 50 (Ubuntu 26.04), Wayland session
- `gstreamer` with the PipeWire / V4L2 plugins for the Mirror (normally installed)

## Install

```bash
git clone https://github.com/bekov0004/Osmin.git
cd Osmin
scripts/install-dev.sh          # copies into ~/.local/share/gnome-shell/extensions and compiles the schema
```

Log out and back in (Wayland cannot restart the shell in place), then:

```bash
gnome-extensions enable osmin@bekov0004.github.io
gnome-extensions prefs osmin@bekov0004.github.io     # the settings window
```

Without logging out, try it in a nested shell (needs `mutter-devkit`):

```bash
scripts/install-dev.sh --nested
```

Alternatively build a package: `gnome-extensions pack --extra-source=src --schema=schemas/org.gnome.shell.extensions.osmin.gschema.xml`
and install the zip with `gnome-extensions install`.

If the settings schema is not compiled (a hand-copied extension) Osmin still works with its defaults.

## Uninstall

```bash
gnome-extensions disable osmin@bekov0004.github.io
rm -r ~/.local/share/gnome-shell/extensions/osmin@bekov0004.github.io
rm -r ~/.local/share/osmin ~/.cache/osmin      # optional: tray, timer, to-do, cached artwork
```

## Logs

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i osmin
```

## How it works

- `PanelService` hides `Main.panel.statusArea.dateMenu.container` (and re-hides it if the panel
  shows it again on a session-mode change), adds an invisible anchor button to the panel's center
  box and overrides `Main.panel.toggleCalendar` with `InjectionManager`. `destroy()` undoes all of it.
- The capsule is a single actor in the shell's chrome (part of the shell, not a window),
  positioned from the anchor. Its top edge never moves: only x, width and height are animated,
  so it reads as one object growing out of the top bar. Sizes are CSS px (scaled by the UI scale);
  the expanded width is a share of the monitor width, clamped.
- Dragged files: GNOME Shell cannot be a real Wayland drop target, but it is told where the pointer
  is during a drag (`global.backend.get_dnd()`) and can read what is dragged (`Meta.Selection`,
  `SELECTION_DND`). Osmin treats "button released over the capsule" as a drop (Escape leaves the
  button held, so it is told apart). Nothing is accepted from the source, so nothing is copied.
- Keyboard input (the to-do entry) uses a modal grab on the capsule (`Main.pushModal`) that ends on
  Escape, a click outside, or when the capsule closes.

### Architecture

```
 source ──emit()──> EventManager ──event──> CardManager ──host calls──> Osmin ──> cards
                                                                         ^
 widget ──start()/stop()──> ActivityManager ── compact view (collapsed capsule)
                                  └── peek ──> event -> card pipeline
```

- **Events and cards:** `EventManager.emit({type, title, message, icon, priority, id, duration,
  persistent})`. `CardManager` shows one card at a time, queues the rest by priority
  (`low < normal < high < critical`), updates a card with the same id in place, pauses the auto-hide
  while the pointer is over the capsule. Card phases: hidden, opening, visible, updating, closing.
- **Widgets** live in `src/widgets/<name>/`, extend `OsminWidget` (`createView`, `start`, `onTick`,
  `onPageShown`, `onPageHidden`) and are listed in `src/widgets/registry.js`; the expanded capsule
  lays them out three per page.
- **Live Activities:** a widget creates a `LiveActivity` (compact view + peek view) and registers
  it with `ActivityManager` (`start` / `end` / `peek`).

## Project structure

```
metadata.json  extension.js  prefs.js  stylesheet.css
schemas/org.gnome.shell.extensions.osmin.gschema.xml
scripts/install-dev.sh
src/
  osmin.js                  the capsule: actor, states, animations, gestures, settings
  services/
    panelService.js        replaces the GNOME clock: hide, anchor, position, Super+V
    eventManager.js  cardManager.js  activityManager.js  settingsService.js
    clockService.js        GnomeDesktop.WallClock ticks
    mediaService.js  artworkService.js        MPRIS, cover art cache
    calendarService.js                        org.gnome.Shell.CalendarServer
    fileService.js  dragService.js            file tray, drag detection
    timerService.js  todoService.js  cameraService.js
  ui/                      closedView, osminPanel, dropView, cards, liveActivity, button
  widgets/                 media/ calendar/ files/ timer/ todo/ mirror/  + widget.js, registry.js
  debug/testEvents.js      sample events for development
  utils/                   constants, events, animation, scale, signals, timers, jsonStore, widgetInfo
```

## Known limitations

- While Osmin is enabled, GNOME's notification list and Do-Not-Disturb popup (part of the date
  menu) are not reachable; notification banners still appear as usual.
- A shell extension cannot start a drag into another application. Files are moved out through
  *Copy* (they go to the clipboard as `text/uri-list`) or *Open* / *Show in folder*.
- The Mirror was verified with a test video source; the PipeWire / V4L2 path needs a camera
  your user may access (a seated desktop user normally can).
- Dragging files over the capsule while a card is showing is ignored until the card is gone.
