# Changelog

All notable changes to Osmin are written here, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
