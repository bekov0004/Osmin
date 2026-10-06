# Osmin

A Dynamic Island-style capsule for GNOME Shell 50 that **replaces the GNOME
clock** in the middle of the top bar. At rest it is a compact capsule showing the time;
on hover or click the same capsule grows into a wide panel.

## Features

- **Replaces the clock/calendar button.** While Osmin is enabled the GNOME date menu button is
  hidden; disabling Osmin brings it back unchanged. Nothing in the system is modified.
- **Collapsed** – a capsule with the time (follows the 12/24 h setting), inside the top bar,
  in the exact spot of the old clock. A small dot appears when an event came in while closed.
- **Hover** – the capsule swells slightly; if the pointer stays, it opens after a short dwell,
  so brushing across the top bar does nothing. Click opens it immediately.
- **Expanded** – one wide capsule with three sections: media (placeholder), time + date + week
  calendar (placeholder for a full calendar), and workspace / quick actions (placeholders) /
  notifications container. Plus a temporary strip of test-event buttons.
- **Stays while you use it**, collapses shortly after the pointer leaves.
- **Cards** – any event can show a card in the capsule (queue, priorities); see "Events and cards".
- `Super+V` (the "toggle calendar" shortcut) toggles Osmin instead of the hidden calendar popup.
- Wayland-native, HiDPI-aware, adapts its width to the monitor, follows the "enable animations" setting.

## How it works

- `PanelService` hides `Main.panel.statusArea.dateMenu.container` (and re-hides it if the panel
  shows it again on a session-mode change), adds an invisible anchor button to the panel's center
  box and overrides `Main.panel.toggleCalendar` with `InjectionManager`. `destroy()` undoes all of it.
- The capsule is a single actor in `Main.layoutManager` chrome (part of the shell, not a window),
  positioned from the anchor's real position. Its top edge never moves: only x, width and height
  are animated, so it reads as one object growing out of the top bar.
- Sizes (CSS px, multiplied by the UI scale): collapsed = text width + 30 (min 88) by panel height − 6;
  open = 36 % of the monitor width clamped to 620–780 (and to the screen minus margins), height from
  the content (about 180). Constants are in `src/utils/constants.js`.
- Timing: rest 80 ms, swell, open after 260 ms more; collapse 450 ms after the pointer leaves
  (+1.4 s if you just clicked inside).

## Known limitations

- While Osmin is enabled, the GNOME notification list / Do-Not-Disturb popup (part of the date menu)
  is not reachable. Notification banners still appear as usual. The notifications container in Osmin
  is a placeholder for now.
- Needs a top bar in the center box layout of the default Ubuntu/GNOME panel.

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
- **Disable/enable cycle** to check `disable()`/`enable()` cleanup:
  `gnome-extensions disable osmin@bekov0004.github.io && gnome-extensions enable osmin@bekov0004.github.io`.
  This does **not** re-read changed JS files; GJS caches modules until the shell restarts.

Logs:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Constants (sizes, durations, delays, gap under the top bar) live in
`src/utils/constants.js`; colors and radii live in `stylesheet.css`.

## Events and cards

```
 source ──emit()──> EventManager ──event──> CardManager ──host calls──> Osmin ──> OsminCard
 (anything)         validate/normalize      queue, priority,            window     UI only
                                            timers, phases              + animation
```

Anything inside the extension can send an event; the Osmin instance exposes the bus
as `osmin.events`:

```js
osmin.events.emit({
    type: 'notification',      // notification | media | download | battery | bluetooth
                               // network | usb | workspace | clipboard | custom
    title: 'Download complete',
    message: 'file.zip',       // alias of `description`
    icon: 'folder-download-symbolic',  // icon name or absolute file path (optional)
    priority: 'normal',        // low | normal | high | critical
    id: 'dl-1',                // optional; the same id updates the card in place
    duration: 3500,            // optional, ms
    persistent: false,         // true: stays until clicked
});
```

An event is the card model: `normalizeEvent()` (`src/utils/events.js`) fills in defaults
and the CardManager works with the result. Unknown types become `custom`; events with
neither title nor description are ignored.

**Priority and queue**

| priority   | behaviour                                                    | default duration |
|------------|--------------------------------------------------------------|------------------|
| `low`      | waits behind everything, never interrupts                    | 2.5 s            |
| `normal`   | waits its turn (first in, first out)                         | 3.5 s            |
| `high`     | interrupts a `low`/`normal` card; the interrupted one goes back to the front of its group | 5 s |
| `critical` | interrupts anything, never hides by itself                   | until clicked    |

- One card at a time. The rest wait in a queue ordered by priority, FIFO within a priority;
  the visible card shows `+N` for the number waiting. The queue holds at most 32 cards
  (the oldest lowest-priority one is dropped).
- A card with the id of a visible or queued card updates it in place (no duplicate).
- Hovering the island pauses the auto-hide timer; clicking a card dismisses it.
- If the panel was open when a card arrived, it is reopened after the last card.

**Card phases** (CardManager): `hidden → opening → visible → updating → closing`.
`CardManager` API: `show`, `update(id, patch)`, `replace(id, card)`, `hide(id)`,
`hideCurrent`, `clear`.

To add a card type, create a class extending `OsminCard` and register it in
`src/widgets/cardFactory.js`; types without a card class use `NotificationCard`.

## Project structure

```
metadata.json            extension metadata (uuid, shell-version: 50)
extension.js             entry point: enable()/disable()
stylesheet.css           all styling
src/
  osmin.js                the capsule: actor, states, animations, CardManager host
  services/
    panelService.js      replaces the GNOME clock: hide, anchor, position, Super+V
    clockService.js      GnomeDesktop.WallClock ticks
    workspaceService.js  active workspace index / count
    eventManager.js      emit()/subscribe(); validates events
    cardManager.js       queue, priority, timers, card phases
  widgets/
    closedView.js  openView.js                    capsule states
    sections/  mediaSection.js  calendarSection.js  statusSection.js
    clockWidget.js  weekStrip.js  workspaceWidget.js  button.js
    osminCard.js  notificationCard.js  cardFactory.js     cards
  debug/testEvents.js    temporary test buttons
  utils/
    constants.js  events.js  animation.js  scale.js  signals.js  timers.js
```

## Ideas for next steps

Real notification source (GNOME), media controls (MPRIS), a D-Bus interface so scripts can
emit events, per-monitor following of the focused window, preferences, keyboard shortcuts.
