# Osmin

A Dynamic Island-style capsule for GNOME Shell 50 that **replaces the GNOME
clock** in the middle of the top bar. At rest it shows the time (or what is going on: a timer,
the music, a meeting); on hover or click the same capsule grows into a wide panel with widgets.

Everything runs inside GNOME Shell (GJS): no Electron, no helper app, no root, no system files
are touched, and disabling the extension brings the stock clock back.

## Features

The capsule has two parts: a small **collapsed** island in the top bar (the time, or
what is going on) and an **expanded** container that hangs from the top edge of the screen:

```
  ┌──────────────────────────────────────────────────┐
  │ [Osmin] [Tray]                  ● (camera)      ⚙ │   header: in the band of the top bar
  ├────────────────┬─────────────────┬───────────────┤
  │  Media Player  │    Calendar     │   Mirror      │   widgets, side by side
  └────────────────┴─────────────────┴───────────────┘
```

- **Osmin tab – widgets**, in the order you choose, each with its own width (in cells). The capsule
  grows or shrinks with them; if they do not fit on the screen they go on extra pages.
  - **Media Player** – any MPRIS player: artwork with the player's icon, title, album, artist,
    previous / play-pause / next, a small activity indicator, a thin progress line (click to seek).
  - **Calendar** – the month and a strip of days around the selected one (today accented), and that
    day's events from the system calendars (`org.gnome.Shell.CalendarServer`, the service the GNOME
    calendar uses).
  - **Mirror** – a round webcam preview (GStreamer: PipeWire, then `/dev/video0`). The camera is
    opened only when you click the circle and released when you click it again, change tab or page, or
    close the capsule; a green dot in the header shows it is on. Nothing is recorded.
  - **Shortcuts** – quick launchers for apps you pick in the settings (a *Detected / In use* editor),
    one or two columns of two rows. Off by default.
  - **Timer** and **To-do** – optional widgets (off by default; enable them in the settings).
- **Tray tab – the file shelf.** Drag files from any app over the top of the screen: the capsule
  expands into the tray and shows the drop target; release to add them. Files are referenced, never
  copied or moved; they stay until removed (or deleted/moved on disk). Per file: open, show in the file
  manager, copy to the clipboard, remove. The wheel scrolls the row sideways. While dragging, a second
  target sends the files by Bluetooth (GNOME's *Send files* dialog). **Drag a file out of the tray**
  into any other app or folder.
- **Clipboard tab – history and notes.** Everything you copy as text (Ctrl+C) appears as a card, newest
  first. A click puts it into the app you were using (Ctrl+V; or only copies, see the settings); hover
  for copy / pin / remove. The first card is for your own notes (Enter saves them). Pinned items and
  notes are saved; the rest of the history is only kept in memory unless you turn on *Keep history*.
  Only text is recorded and password managers' copies are skipped.
- **Live Activities** – a running timer, music, or a meeting within 10 minutes takes the place of
  the time in the collapsed capsule; track changes, meetings, a finished timer and added files pop out
  as short cards hanging from the top. Clicking a card opens its widget.
- **Gestures** – the pointer approaching the collapsed capsule wakes it; if it rests, the capsule
  swells and then opens (click opens at once); the wheel / a swipe switches pages. Touchpad swipes:
  down opens, up closes; sideways over the collapsed capsule skips tracks while music plays; a middle
  click flips between activities or plays / pauses. All of it (and *invert direction*) is in the
  Gestures settings.
- **Settings** (the ⚙ in the header, or `gnome-extensions prefs`) – a window with these pages: General, Osmin (widgets: on/off, order, width in cells, a live preview, auto or fixed
  capsule width), Appearance, Gestures, Tray, Clipboard, Live Activities (album corner radius, spectrum or waves
  effect, colours from the album art), About. Changes apply live.

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
- Layout: `ui/osminLayout.js` computes the expanded size from the enabled widgets (cells × cell width +
  spacing + padding), the screen width and the UI scale, so nothing is tied to one resolution. The
  header is exactly as tall as the top bar; the content hangs below it, and two small "ears" (cairo
  fillets) join the capsule to the bar so it reads as one shape.
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
  ui/                      closedView, osminPanel (header, tabs, pages), osminLayout, ear, cards, liveActivity, button
  tray/                    trayView, trayController, fileItem, filesActivity
  widgets/                 media/ calendar/ mirror/ timer/ todo/  + widget.js, registry.js
  debug/testEvents.js      sample events for development
  utils/                   constants, events, animation, scale, signals, timers, jsonStore, widgetInfo
```

## Known limitations

- While Osmin is enabled, GNOME's notification list and Do-Not-Disturb popup (part of the date
  menu) are not reachable; notification banners still appear as usual.
- Quick Apps are not implemented. There is
  no AirDrop; the second drop target sends files by Bluetooth instead.
- A shell extension cannot start a drag into another application itself. Dragging a file out of the
  tray works through a tiny helper window (`src/helpers/dragout.js`) that the shell puts under the
  pointer and drives with a virtual touch; *Copy* / *Open* / *Show in folder* remain as well.
- The Mirror was verified with a test video source; the PipeWire / V4L2 path needs a camera
  your user may access (a seated desktop user normally can).
- Dragging files over the capsule while a card is showing is ignored until the card is gone.
- Osmin lives on the primary monitor (where the top bar is).
