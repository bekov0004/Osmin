# Changelog

All notable changes to Osmin are written here, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Reminders brought by the butterfly: at the time you choose it flies out of the capsule, beating its wings and growing as it comes down, hovers at the top of the screen (also over an app in full screen) and shows your text, with "In 10 min" and "Done"; then it flies back into the capsule. Once, every day or on weekdays; a short sound (can be turned off); one missed while the computer slept still comes up to 3 hours late. Set them in the new Reminders tab of the quick panel (or click the butterfly in the capsule), or in Settings → Dynamic Island → Appearance → Reminders; "Try it" shows one at once.

- The Osmin bar: a top bar on every monitor without GNOME's (Settings → General → Top bar). On the left the desktops of that monitor (a dot switches, the free space opens the overview), in the middle its capsule or the date and time, on the right the items of GNOME's top bar (the readings, the Osmin button, network, sound, battery ...) whose menus open on that monitor. It hides on its own setting, like the top bar.
- The top bar can hide (Settings → General → Top bar): never, when a window touches it (the default), or always. Hidden, it comes out when the pointer pushes against the top edge of the screen, also over an app in full screen, and stays while the pointer is on it, a menu of it is open or the capsule is in use; it is always there in the overview. The capsule hides and comes out with it. The monitors without GNOME's top bar have the same choice for their capsule.

### Fixed

- A capsule on a monitor with an app in full screen no longer appears and disappears over and over when the pointer is where it would be: it stays hidden until the pointer pushes against the top edge, then it comes out over the app.

## [0.3.1] - 2026-11-20

### Added

- Osmin has its own logo: the island hanging from the top edge, with a butterfly in it (the small capsule that opens into a panel, like a chrysalis into a butterfly). It is the icon of the Osmin app, stands on the settings' About page and above the name in the README; the quick panel has the butterfly alone at its top (instead of the planet).
- The Osmin button in the top bar shows the logo's butterfly by default (a one-colour icon like the others there) instead of the grid of dots; it is the first choice in Settings → Menu bar → Menu bar icon.
- The closed capsule has a little butterfly in the middle instead of the camera circle, looking at you (a round face with big eyes, pink cheeks and a smile). Now and then it beats its wings and then blinks; its wings turn warm when something happened. Settings → Dynamic Island → Appearance, at the top: Butterfly on or off (off brings the circle back), flapping on or off, and how often (every 5 to 300 seconds, 30 by default).
- The Osmin tab of the panel has the butterfly as its icon instead of the grid.
- README: new screenshots of the Command Bar, the settings app, the AI agents (window and question card), the quick panel and a top-bar reading.

### Changed

- AI agents: when Claude's last message is its answer, the "Done" box no longer repeats it.

## [0.3.0] - 2026-11-20

### Added

- AI agents: start Claude Code from Osmin and follow it live. In the background, the quick panel and the agents window of the Osmin app show what it is doing right now (every file it reads or edits, every command), its answer and its cost; you can tell it more, pause it, stop it and continue it later. Before it edits a file or runs a command it asks: a card in the capsule (and the panel, and the window) has Allow, Always in this task and Deny. Or open Claude Code (or Codex) in a terminal in the project folder. Recent projects come from the agents' own logs; agents working elsewhere are still shown.
- AI agents: the Claude plan's real limits, as `/usage` shows them: the 5-hour window and the week, how much is used and when each starts again.
- LocalSend: choose the folder received files are saved in (Settings → General, under LocalSend); Downloads when none is chosen or the chosen one cannot be used.
- Top bar: every reading (CPU, temperature, GPU, memory, battery, network, disk, disk activity, power) is a button of its own; pressing it opens a small window under it with more about it: a graph of the last minutes, the numbers behind it (the busiest apps, swap, the network and address, time left ...) and a button to its page in the quick panel.
- Settings → General: "Open after" and "Close after" set how long the pointer rests on the capsule before it opens and how long it stays open after the pointer left; Animation speed now goes from 0.25 to 4.
- Displays (quick panel): a brightness slider for every monitor (GNOME's own control, ddcutil, or Osmin dimming the picture of a monitor that has none), and the arrangement: a picture of the monitors to drag them to any side, Left / Right / Above / Below buttons, the main monitor, and Join / Mirror / Only one. Moving monitors applies at once; Mirror and Only one ask GNOME's "Keep these display settings?" and go back by themselves.
- Touchpad gestures everywhere (Settings → Touchpad gestures): every three- and four-finger swipe, pinch and rest can be given an action. Three fingers sideways switch apps like Alt+Tab (the switcher follows the fingers), three up and down the overview, four sideways the workspaces (GNOME's own, following the fingers); more than fifty actions, including any keys. Two fingers stay with the apps.
- Phone: a phone connected through the Osmin Phone app is remembered, as a phone of adb was: the tile shows its name ("Tap to open" when it answers on the network), and a click opens its screen at once (the computer dials the phone where it was last, then searches); no "Use the Osmin Phone app" every time.
- Osmin Phone, both ways: the server on the phone listens too (port 47832) and the Phone card on the computer looks for the phone in the networks it is in (where it was last, the neighbours, then the rest), so the computer can reach a phone that is asleep, wake it and unlock it without touching it; whichever side gets there first wins. Same secret, same proof both ways.
- Osmin Phone finds the computer by itself: the server the app starts stays running, and when the network changes (Wi-Fi, a hotspot of the computer, the phone's own hotspot, USB tethering) or the session ends, it searches the new network for the computer's port and connects again, without anyone touching anything; a heartbeat on both sides shows a dead network within seconds, and the Phone card goes back to "Waiting for the phone…" and takes it again. The connection no longer sends the secret (challenge and proof both ways, so a machine that only answers on the port learns nothing). "Disconnect the phone" in the ring ends the server.
- Osmin Phone has its own adb client (Kotlin: SPAKE2 pairing, TLS 1.3 connect, shell), so the phone can be connected without adb on the computer: the Phone card has "Use the Osmin Phone app" (a link and a QR code; the app pairs with the phone's own wireless debugging once and starts its server, which dials the computer). The client was tested against a fake adbd and against the real `adb` of a computer. Wireless debugging and Developer options on the phone are still needed (Android allows nothing else).
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

- Command Bar: the capsule itself turns into a big search field at the top (no tabs) that grows with its results; results in groups (Applications, Calculator, Clipboard, Web, Snippets, Processes, Cache) with large icons, chips with what can be typed while the field is empty, and a line with the keys. The Search tab left the panel: the bar opens with its shortcut, the Utilities widget, the radial menu or a gesture.
- The Osmin app is the settings: the app grid icon and the Settings button open them as the Osmin app's own window (its name and icon in the dock and Alt+Tab, with minimize and maximize), not as a window of the Extensions app. The service status moved to a button on the About page.
- UX pass of the quick panel, the capsule and the settings: arrows at the ends of the tab row when there are more tabs; temperatures, battery health and a microphone the computer does not have are left out instead of "n/a" or an empty list; automatic brightness only shows with a light sensor; the volume lines sit in the card like the other rows; the small actions of LocalSend, the Tray and Alerts (Add from Tray, Refresh, Receiving, Clear, Do Not Disturb) look like buttons; the empty Tray says what it is for; one wording for "Desktops only on the main monitor" everywhere, shorter hints; the Quick panel settings page no longer repeats the pages of Quick toggles, the microphone, the camera, the scratchpad and Cleaning Mode; up-to-date descriptions of Displays, Windows and Desktops.
- Windows: a desktop's tab only changes the picture, not the screen, so the windows of every desktop can be arranged from where you are; the desktop on the screen has a dot.
- The quick panel and the dark settings window have the capsule's own colours: black, with dark grey cards, buttons and the chosen tab, instead of blue-grey.
- Quick panel: the icon tabs keep their size; when there are more than fit, the row scrolls sideways (mouse wheel, touchpad), its ends fade out, and the chosen tab is brought into view.
- Windows (quick panel): instead of the Left / Right / Top / Bottom buttons, a picture of the screen with live miniatures of its windows. Choose the monitor above it and the desktop with its tab; drag a window to move it (at an edge it takes half or a quarter of the screen, at the top all of it), onto another desktop's tab or another monitor to send it there; click it to bring it forward, ✕ to close it. Beside the picture: Columns, Rows, Grid, Main + side and Undo.
- Radial menu: alive instead of static. It opens out of the pointer, the buttons fly out one after the other, the action the pointer points at (anywhere in its slice) is lit, grows and shows its name in the middle, a small light follows the pointer around; the chosen button pulses as the wheel closes. Arrow keys go round, Enter runs, Esc or a right click closes.
- Settings: shortcut keys are written as on a PC keyboard (Shift, Ctrl, Alt, Super), not with Mac symbols.
- Shortcuts: any keys can be given to an Osmin shortcut; when GNOME already uses them (Super+V, for example), Osmin takes them while it runs and gives them back afterwards. The "Free Super+V from GNOME" switch is gone (what it had taken is given back). While a shortcut is being recorded the keys go to the settings window, not to GNOME.
- Settings: **Features** now says what each tool costs while it is on ("Nothing at rest", "Checks every
  10 s" ...).
- Settings: **Features** now has a count and one-click bundles (Everything, Essentials, Light island), and
  every line says where it appears (*Top-bar button* or *Island*). New **Tools window** page for the
  tabs and their order; the **Widgets** page is only for the island.
- Every page of the tools window is built from the same cards, rows with switches and chips.
- The capsule keeps only the light widgets (music, calendar, mirror, timer, to-do, notes, shortcuts,
  companion); the tools moved to the new window. They are on by default, and Settings → Features
  turns each on or off as before.

### Fixed

- Settings opened from the Extensions app were titled "Extension Error".
- "Close after" is kept: a short delay closes the capsule at once, also just after a click inside it (the extra time after a click is now in proportion to the delay, at most 1.4 s).
- Settings window: no wide empty margins around it; the menu on the left and the page on the right scroll on their own.
- Top bar: pressing the Osmin button lights only the button, not the CPU and temperature readings beside it; the readings are an item of their own that opens the System page.
- Separate desktops for every monitor really are separate: switching desktops on the laptop (keys, gestures, the overview) no longer switches the other monitor. The main monitor keeps GNOME's desktops; every other monitor has its own, switched by the same keys (Super+Page Up/Down, Ctrl+Alt+arrows, Super+number, with Shift to take the window) and four-finger swipes while the pointer is on it, with a small "Desktop 2" sign.
- Shortcuts recorded with the Russian (or another non-Latin) layout on were saved as Cyrillic keys and did not work; they are recorded as the Latin key now, and old ones are corrected. Two shortcuts can no longer have the same keys (the Quick panel's suggested keys were the Clipboard's: now Ctrl+Super+Q); the new one takes them and says from which. Shift+letter alone is refused (it would stop that letter from being typed); F-keys and Print work alone.

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

[Unreleased]: https://github.com/bekov0004/Osmin/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/bekov0004/Osmin/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/bekov0004/Osmin/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/bekov0004/Osmin/releases/tag/v0.2.0
