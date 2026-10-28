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
  - **Quick Toggles** – keep awake (30 min / 1 h / 2 h / until turned off, done by the service),
    dark mode, night light, lock the screen, empty the trash (asks twice), screenshot, screen
    recording (GNOME's own tool), a colour picker (the pixel's HEX is copied, RGB / HSL shown),
    a cleaning mode (black screen, keyboard and pointer locked; hold Esc 3 s, ends by itself after
    a minute), eject USB drives, and a brightness slider for the built-in screen.
  - **Focus** – a Pomodoro timer (focus, short break, a long break every 4th round; the phases follow
    each other by themselves) and a stopwatch with laps; both run in the service and show in the capsule.
  - **System** – processor, memory, temperature, network, disk and battery with little bars. The
    service also raises alerts (a processor busy for 30 s, heat, memory or disk nearly full, a low
    battery, also of keyboards and mice) as cards; they can be turned off in the settings.
  - **Sound** – volume, output switch, microphone mute and the volume of each application.
  - **Downloads** – what arrives in the Downloads folder (browser `.part` / `.crdownload` files and
    plain writes), with size and speed in the capsule and a card when it is done.
  - **Input** – switches for mouse / touchpad natural scrolling, mouse acceleration, tap to click,
    focus follows mouse and key repeat (GNOME's own settings, one press each way).
  - **Windows** – live previews of every open window (click to bring it forward, ✕ closes it) and
    buttons that snap the window you were working in to the left / right / top / bottom half, maximize,
    centre, send it to the next monitor, or put it back where it was.
  - **AI Agents** – Claude Code and Codex: working now (and in which project), the tokens of the last
    5 hours and the last week, and a card when a task of more than a minute finishes. Read from the
    agents' own session logs on this computer (only times and token counts; prompts are not looked at).
  - **Companion** – a small friend: its eyes follow the pointer, it sways to the music, is surprised by
    cards and falls asleep when nothing happens.
  - **Music lyrics** (optional, off by default) – the line being sung replaces the album line under the title;
    the song is looked up on lrclib.net (artist, title, album and length are sent there).
- **Search tab (command bar)** – one field: launch an application, calculate (`12*(3+4)`, `2^10`,
  `sqrt(16)`), convert units (`5 km to mi`, `100 f in c`), find something you copied, search the web
  (DuckDuckGo), `kill <name>` lists your processes and `ports` the ports they listen on (stopping asks
  twice; only your own processes), `clean` shows the biggest folders of `~/.cache` and empties one
  (asks twice; the programs make their cache again), `;trigger` pastes a text snippet (`snip add ;mail = me@example.com`,
  `snip rm ;mail`, `snippets`; `{date}`, `{time}` work inside), `scratchpad` opens the Scratchpad window of the Osmin app (notes of
  any length, saved as you type, export to Markdown). A shortcut can open it (settings → General).
- **Settings** (⚙ or `gnome-extensions prefs`) – a sidebar with a search field; the first page, *All
  features*, lists every feature of Osmin by category with a switch and a line of description (widgets are
  added to / removed from the capsule, the rest are settings); the other pages hold the details.
- **Small extras** – copied links can lose their tracking parameters (utm_*, fbclid ...; settings →
  Clipboard); a card shows the keyboard layout when you switch it; the panel is never narrower than its tabs.
- **Alerts** tab – the notifications the shell holds (click opens the app, ✕ dismisses, Clear all) and a Do Not Disturb switch. Nothing is stored by Osmin.
- **Monitors** – choose which monitors get a capsule (settings → General → Show on); the services and Live Activities are shared, each monitor has its own capsule and panel.
- **Shortcuts** – a key for each section (Osmin, Tray, Clipboard, Alerts) opens the panel on it; pressing it again closes the panel. Set them in settings → General; none are set by default. GNOME itself uses Super+V (its notification list); the switch "Free Super+V from GNOME" takes that binding away while Osmin is enabled and restores it on disable, so Super+V can be recorded for Clipboard.
- **Pull to enlarge** – in the Clipboard and Alerts tabs a two-finger swipe down grows the panel to fit all its items (at most 40% of the screen height; with a single item nothing changes), a swipe up shrinks it back. The list always scrolls first: the panel resizes only when the list has reached its top (swipe down) or bottom (swipe up), or has nothing to scroll. It resets when the panel closes or the tab changes.
- **Enlarged mirror** – a button on the Mirror circle (or a two-finger swipe down over it) turns the capsule into a card as wide as the music card but taller, with a big square preview and a vertical zoom slider; its corner button (or a two-finger swipe up) shrinks it back.
- **Enlarged calendar** – the same for the Calendar: a button (shown on hover) or a two-finger swipe down over it turns the capsule into a taller card with a month grid and the events of the chosen day; a swipe up or the corner button shrinks it back.
- **Tray tab – the file shelf.** Drag files from any app over the top of the screen: the capsule
  expands into the tray and shows the drop target; release to add them. Files are referenced, never
  copied or moved; they stay until removed (or deleted/moved on disk). Per file: open, show in the file
  manager, copy to the clipboard, remove. The wheel scrolls the row sideways. While dragging, a second
  target puts them in the **LocalSend** section (a tab next to Tray) instead: the files wait as chips in the top
  row (drop more, "Add from Tray", the send button on a tray file or "Send all", ✕ to remove), the devices
  running [LocalSend](https://localsend.org) on your network are tiles in the row below, and a click on one sends
  (the other device asks its user to accept). The protocol is built into Osmin; the LocalSend app is not
  needed. Folders are skipped.
  **Receiving** is off by default: Settings → General → LocalSend → *Receive files* makes the computer
  visible to LocalSend devices (it listens on port 53317 with its own certificate, so close the LocalSend
  app first). Every transfer asks in a card (Accept / Decline, 60 s then it is declined); accepted files are
  streamed to the Downloads folder under a free name (`name (1).ext`), never over an existing file. **Drag a file out of the tray**
  into any other app or folder.
- **Clipboard tab – history and notes.** Everything you copy as text (Ctrl+C) appears as a card, newest
- **Drag out of Clipboard** – press an item and drag it into any other app: a text is dropped as text, a copied file as the file (the same helper window as for the Tray, see the notes below).
- **Copied files** – a file copied in the file manager appears in Clipboard as its name with the file icon (not as a path); clicking it pastes the file itself (a file manager gets its own file type, browsers and chats a uri list, terminals and editors the path).
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

## How it is built: an extension and a service

Osmin is two parts that talk over D-Bus (`io.github.bekov0004.Osmin`):

- the **extension** (`extension.js`, `src/`) is the face: the capsule, panels, cards, gestures, and
  everything that has to live inside the shell: capturing the clipboard, notifications, key
  bindings, the monitors, dragging, the camera preview, the music (MPRIS) players, the settings;
- the **service** (`service/`, a plain `gjs` process, also the *Osmin* app in the app grid) does the
  work that waits, reads files or talks to the network:

  | module | what it does |
  |---|---|
  | LocalSend | finding devices, sending, receiving (the HTTPS server, the certificate) |
  | Files | the file tray: the list, thumbnails, watching the files, saving |
  | Calendar | reading the system calendars |
  | Timer | the clock, the saved state, the moment it runs out |
  | Todo, Notes | the lists and where they are saved |
  | Artwork | downloading album covers, finding their colour |
  | Clipboard | where the clipboard history is kept on disk |

The service runs in a process of its own, so a slow or broken job can never freeze the desktop, and
it can be restarted without logging out. It is started by D-Bus activation the first time the
extension asks, and ends by itself when the extension is gone. What it says goes to
`~/.cache/osmin/service.log`. Opening *Osmin* from the app grid shows a small window with its status.

Each feature of the service is a *module* (`service/module.js`): it owns a JSON state, answers calls
(`rpc_<method>`) and sends events; the extension's `src/client/moduleClient.js` mirrors the state
and the services in `src/services/` give the widgets the same API as before. Without the service the
extension still runs; only the features that live in the service are unavailable (calls wait a few
seconds for it to start, then report that it is not running).

## Install

```bash
git clone https://github.com/bekov0004/Osmin.git
cd Osmin
scripts/install-dev.sh          # the extension + the Osmin service, all in ~/.local/share (no root)
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

`scripts/uninstall.sh` removes the extension, the service and its D-Bus file (your data stays).

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
    timerService.js  todoService.js  cameraService.js  (mirrors of the service's modules, see above)
    focusService.js  systemService.js  downloadsService.js  lyricsService.js
  ui/                      closedView, osminPanel (header, tabs, pages), osminLayout, ear, cards, liveActivity, button
  tray/                    trayView, trayController, fileItem, filesActivity
  widgets/                 media/ calendar/ mirror/ timer/ todo/ notes/ tools/ focus/ system/ sound/ downloads/ input/  + widget.js, registry.js
  commandbar/              the Search tab (engine.js: calculator and converter; commandView.js)
  client/moduleClient.js   the extension's end of the D-Bus modules of the service
service/                   the Osmin service and app: main.js, module.js, window.js, scratchpad.js, <module>/module.js
  debug/testEvents.js      sample events for development
  utils/                   constants, events, animation, scale, signals, timers, jsonStore, widgetInfo
```

## Known limitations

- While Osmin is enabled, GNOME's notification list and Do-Not-Disturb popup (part of the date
  menu) are not reachable; notification banners still appear as usual.
- Not done: OCR / QR from the screen (needs extra programs), "Watch" any part of a window, an equalizer
  that follows the real sound, a global text expander (Wayland does not let a shell extension see what you
  type in other apps; snippets are in the Search tab instead), key debouncing and scroll smoothing, fan
  control and external-monitor brightness (need root or hardware interfaces), the macOS-only tools
  (Homebrew, DMG installer, Spaces order). There is no AirDrop; the second drop target sends files to LocalSend devices instead (and receives them when you turn it on).
- A shell extension cannot start a drag into another application itself. Dragging a file out of the
  tray works through a tiny helper window (`src/helpers/dragout.js`) that the shell puts under the
  pointer and drives with a virtual touch; *Copy* / *Open* / *Show in folder* remain as well.
- The Mirror was verified with a test video source; the PipeWire / V4L2 path needs a camera
  your user may access (a seated desktop user normally can).
- Dragging files over the capsule while a card is showing is ignored until the card is gone.
