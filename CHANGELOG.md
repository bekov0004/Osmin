# Changelog

All notable changes to Osmin are written here, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Osmin Phone, an Android app (Kotlin, `android/`): when it is installed, the phone's server dials the computer and the picture and the control go over that link, not through adb; it works in a network the phone shares as well as in one the computer shares. Without the app everything works through adb as before. `scripts/build-android.sh` builds, tests and installs it.
- Phone: the window the phone is taken out into is frameless: only the screen with round corners, no black body, no border, no title bar. Move it with Alt (or Super) and drag, or drag with the middle button.
- Phone: the unlock first asks the system to show the PIN pad (`wm dismiss-keyguard`), then swipes up as before, and types the code a little later, so it also works on a phone that was already awake in the dark.
- Phone: nothing is drawn over the phone's screen any more. A right click opens a ring of round buttons around the pointer (Back, Home, Recent apps, Notifications, Dark screen, Wake, Unlock, Open in a window or Put back in the panel, Close), with the name of the button under the pointer in the middle; a click anywhere else closes it, the left button stays the finger. The same in the capsule card and in the window.
- Phone: the phone's screen is never lit by Osmin by itself. No more "wake" key every 15 seconds (the helper tells the system the user is active instead, which lights nothing); the unlock and the new Wake button (sun) wake the phone only if it is asleep, and the helper switches the panel off again every 40 ms while it wakes and every 400 ms afterwards, in case a notification lights it; closing the card or window in the dark puts the phone to sleep instead of lighting it. Turning the dark screen off with the moon is the only way the panel is lit again.
- Phone: the picture is requested again (up to six times) when the phone's encoder refuses right while its screen changes state; before, the card stayed empty with "The phone did not send a picture" when the screen was darkened at the moment of opening.
- Phone: the dark screen now works on Android 14 and newer, tested on an HONOR phone with Android 16 (MagicOS 10): the display control library is loaded from the right class, together with the vendor's additions to services.jar (services-magic.jar), once per run; the helper no longer crashes on exit.
- Phone: the phone's own screen stays dark while you use it from the computer (on by default; Settings > Phone, and a moon button for one session). The phone stays awake and unlocked but its panel is off, through Osmin's helper on the phone (the same way as scrcpy's --turn-screen-off); if the phone does not allow that, Osmin says so and changes nothing else. The light is given back when the card or window closes. Fixed: the helper was not found, so touches always used the slower `input` commands.
- Phone: taking the phone out into a window sends the panel back to its main section, which closes by itself after three seconds; the cards without a phone (QR code, install adb, "in its own window") are only as tall as what they say.
- Phone: an Unlock button (a lock icon among the buttons that show on hover, in the card and in the window): type the PIN or password once; Osmin wakes the phone, swipes the lock screen up and types the code. The code is not kept anywhere.
- Phone: the window the phone is taken out into has the card's look (no title bar, a black rounded body, the picture with a thin frame, buttons that show on hover; drag the black edge to move it). The phone's screen is woken when the picture opens and every 15 seconds while it is shown, so a sleeping phone no longer gives a black picture.
- Phone: a Phone tile in the capsule (after the Mirror) opens a card like the enlarged calendar: 330 wide, as tall as the phone's screen, which fills it with round corners and a thin frame; the buttons (Back, Home, Recents, Notifications, take out into a window, close) show only while the pointer is over it. The phone can be taken out into a window and brought back. A QR code pairs an Android phone over Wi-Fi (Developer options > Wireless debugging > Pair device with QR code); Osmin connects it with adb. The picture is the phone's own `screenrecord`, decoded with GStreamer with no extra buffering; touches follow the pointer live through Osmin's own small helper on the phone (`phone-helper`), falling back to `input` commands if it cannot start. Needs only `adb`; nothing is installed on the phone. USB-cabled phones appear too.
- Top-bar window: blue-grey palette, flat tab icons with a blue selected tab, round colour dots, small option lines; Keep awake: "Keep awake when Osmin opens".
- Settings: Quick panel page (shortcut that opens the top-bar window from anywhere; quick toggles with keyboard light and excluded drives, microphone, camera, scratchpad and cleaning mode in one place).
- Radial menu: a wheel of favourite actions around the pointer (shortcut, editable list); Output switcher (next sound output, outputs to skip); Camera preview and Scratchpad pages.
- Settings: sidebar in sections (Essentials, Utilities, Sound, Dynamic Island, Tabs); page header with a "Try it" button; pages Command Bar, Quick toggles (excluded drives), Cleaning Mode (keep screen visible), Screenshot and screen recording, Color picker, Volume mixer, Mute microphone; global shortcuts for them and for Keep awake; Feedback row.

- Top-bar window rebuilt after the reference: new tabs Keep awake (timer chips, "until" a time, lid closed, display sleep, icon and colour), Displays (brightness of the screen, external monitors through `ddcutil`, keyboard light, night light), Volume mixer (output, microphone, every app with its own device, reset and mute, boost above 100%), Utilities, Controls (groups with counters) and Quick toggles; customize mode to drag and hide rows.
- Monitor settings: values written in the top bar, update interval, °C/°F, alert limits, blocks of the System page.
- Settings: Menu bar page (reorder tabs by dragging, preview, button icon), Appearance choice (System / Light / Dark) under General.

- Top-bar window redesigned after the reference: logo, page title, one card per page with thin dividers; System (CPU/GPU temperature tiles, usage bars with expandable busiest programs, memory pressure, graphs), Network (one graph for both directions, session, speed test), Disks (disk picker, badges, live activity, temperature, eject, open) and Power (battery, heat, draw, adapter, health).

### Added

- **A button in the top bar with a window of tools**, in the style of Vorssaint: a row of icon tabs and a
  page for each (Windows, Quick Toggles, Focus, System, Sound, Input, Downloads, AI Agents).
- **Windows: arrange all windows at once.** Columns, Rows, Grid and Main + side arrange every open
  window of the monitor, however many there are (4, 6, 10 ...), or only the ones you tick in the
  previews; *Put it back* restores all of them.

- **Desktops tab:** list, switch, create and remove desktops (workspaces), send the current window to a new
  desktop, and two switches for GNOME's *dynamic desktops* and *desktops on every monitor*.
- **Separate desktops for every monitor** (Desktops tab, off by default): switching desktops on one monitor
  no longer switches the others. Osmin keeps a desktop number per monitor and minimises the windows of
  the other desktops of that monitor.

- **Monitoring tabs** in the tools window: **System** (temperature, processor and memory with graphs,
  memory state, swap, uptime), **Network** (download and upload with graphs, connection, local address,
  this session's traffic), **Disks** (every disk with how full it is, eject for removable ones, live
  reading and writing) and **Power** (charge with history, power draw, adapter, battery health, cycles,
  batteries of connected devices).
- Quick Toggles: **Mute mic** and **Screen off**.

### Changed

- Settings: **Features** now says what each tool costs while it is on ("Nothing at rest", "Checks every
  10 s" ...).
- Settings: **Features** now has a count and one-click bundles (Everything, Essentials, Light island), and
  every line says where it appears (*Top-bar button* or *Island*). New **Tools window** page for the
  tabs and their order; the **Widgets** page is only for the island.
- Every page of the tools window is built from the same cards, rows with switches and chips.
- The capsule keeps only the light widgets (music, calendar, mirror, timer, to-do, notes, shortcuts,
  companion); the tools moved to the new window. They are on by default, and Settings → Features
  turns each on or off as before.

## [0.2.0] - 2026-10-30

The first public release: Osmin can be installed from a zip, without cloning or building.

### Added

- **Self-contained install.** The extension starts and restarts its own background service from
  its own folder; no separate service install or D-Bus file is needed. `scripts/install.sh`,
  `scripts/uninstall.sh` and `scripts/package.sh` (builds `Osmin-<version>.zip`).
- **Widgets:** Quick Toggles (keep awake, dark mode, night light, lock, empty trash, screenshot,
  screen recording, colour picker, cleaning mode, eject, brightness), Focus (Pomodoro and
  stopwatch), System (CPU, memory, temperature, network, disk, battery, with alerts), Sound,
  Downloads, Input, Windows (live previews and snapping), AI Agents (Claude Code and Codex),
  Companion, Shortcuts, Notes, optional music lyrics.
- **Search tab (command bar):** launch apps, calculator, unit converter, search the clipboard
  history, web search, `kill` and `ports`, `clean` for `~/.cache`, text snippets (`;trigger`),
  and a Scratchpad window for long notes.
- **LocalSend built in:** find devices, send files from a basket, and (off by default) receive
  them with a card that asks before every transfer.
- **Clipboard tab:** history, pinning, notes, search, copied files, drag an item out into any app.
- **Alerts tab:** the shell's notifications with Do Not Disturb.
- **Monitors:** choose which monitors get a capsule.
- **Shortcuts:** a key for each tab; an option to free `Super+V` from GNOME.
- **Gestures:** swipe to open and close, skip tracks, middle click, invert direction.
- **Enlarged Mirror and Calendar cards**, and a two-finger pull that makes Clipboard and Alerts taller.
- **Keyboard layout and Caps Lock** show inside the capsule itself.
- **Clean copied links** (tracking parameters removed), optional.
- README for users, with screenshots, and the GPL-3.0 license.

### Changed

- Heavy work (LocalSend, tray, calendar, clipboard storage, timers, cover art, lyrics and others)
  moved into a separate service process, so a slow job can no longer freeze the desktop.
- The settings window is redesigned: a floating sidebar with search, titled pages, rounded cards
  and a Features page that lists every feature with a switch.
- The collapsed capsule is exactly as tall as the top bar and no longer hangs over the apps.
- The extension id is now `osmin@osmin.dev` and the D-Bus name `dev.osmin.Osmin`. `install.sh`
  removes earlier installs and carries your data and settings over.

### Fixed

- Enabling the extension failed when the primary monitor was not ready yet.
- The capsule was off-centre at login until the first hover.
- The top bar lost its transparency after leaving the Overview.
- The Mirror circle shrank every time the panel opened.
- Dragging a file out of the tray is more reliable (quick flicks work, no leftover windows).

[Unreleased]: https://github.com/bekov0004/Osmin/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/bekov0004/Osmin/releases/tag/v0.2.0
