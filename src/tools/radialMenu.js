import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** Every action the wheel can start: id -> [title, subtitle, icon]. */
export const RADIAL_ACTIONS = {
    'play-pause': ['Play or pause', 'Media control', 'media-playback-start-symbolic'],
    'next': ['Next track', 'Media control', 'media-skip-forward-symbolic'],
    'prev': ['Previous track', 'Media control', 'media-skip-backward-symbolic'],
    'screenshot': ['Screenshot', 'Tool', 'applets-screenshooter-symbolic'],
    'recording': ['Screen recording', 'Tool', 'media-record-symbolic'],
    'color': ['Color picker', 'Tool', 'color-select-symbolic'],
    'downloads': ['Downloads', 'Open a file or folder', 'folder-download-symbolic'],
    'command': ['Search', 'Command bar', 'system-search-symbolic'],
    'clipboard': ['Clipboard', 'Clipboard history', 'edit-paste-symbolic'],
    'dark': ['Dark mode', 'Quick toggles', 'weather-clear-night-symbolic'],
    'night': ['Night light', 'Quick toggles', 'night-light-symbolic'],
    'mic': ['Mute microphone', 'Quick toggles', 'microphone-sensitivity-muted-symbolic'],
    'awake': ['Keep awake', 'Tool', 'weather-clear-night-symbolic'],
    'cleaning': ['Cleaning mode', 'Tool', 'input-keyboard-symbolic'],
    'lock': ['Lock the screen', 'Quick toggles', 'system-lock-screen-symbolic'],
};
export const RADIAL_DEFAULT = ['play-pause', 'next', 'screenshot', 'downloads', 'color', 'prev'];

const RADIUS = 96;

/**
 * A wheel of the favourite actions around the pointer. Click a button to run it; Esc or a click
 * outside closes the wheel.
 * @returns {{close: () => void}}
 */
export function showRadialMenu(actions, run) {
    const [px, py] = global.get_pointer();
    const size = RADIUS * 2 + 90;
    const x = Math.min(Math.max(px - size / 2, 0), global.stage.width - size);
    const y = Math.min(Math.max(py - size / 2, 0), global.stage.height - size);
    const shade = new St.Widget({reactive: true, x: 0, y: 0, width: global.stage.width, height: global.stage.height});
    const wheel = new St.Widget({
        x, y, width: size, height: size,
        style: `border-radius: ${size / 2}px; background-color: rgba(18, 20, 24, 0.92); border: 1px solid rgba(255,255,255,0.12);`,
    });
    shade.add_child(wheel);
    const hub = new St.Icon({icon_name: 'view-app-grid-symbolic', icon_size: 26, style: 'color: white;'});
    const hubBox = new St.Bin({child: hub, width: 64, height: 64, x: size / 2 - 32, y: size / 2 - 32,
        style: 'border-radius: 32px; background-color: rgba(255,255,255,0.1);'});
    wheel.add_child(hubBox);
    let closed = false;
    let grab = null;
    const close = () => {
        if (closed)
            return;
        closed = true;
        if (grab)
            Main.popModal(grab);
        shade.destroy();
    };
    const list = actions.filter(id => RADIAL_ACTIONS[id]);
    list.forEach((id, i) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(list.length, 1);
        const button = new St.Button({
            reactive: true, can_focus: true, track_hover: true,
            width: 54, height: 54,
            x: size / 2 + Math.cos(angle) * RADIUS - 27,
            y: size / 2 + Math.sin(angle) * RADIUS - 27,
            style: 'border-radius: 27px; background-color: rgba(255,255,255,0.14);',
            child: new St.Icon({icon_name: RADIAL_ACTIONS[id][2], icon_size: 24, style: 'color: white;'}),
        });
        button.connect('clicked', () => {
            close();
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                run(id);
                return GLib.SOURCE_REMOVE;
            });
        });
        wheel.add_child(button);
    });
    shade.connect('button-press-event', (_a, event) => {
        const [ex, ey] = event.get_coords();
        if (ex < x || ex > x + size || ey < y || ey > y + size)
            close();
        return Clutter.EVENT_PROPAGATE;
    });
    shade.connect('key-press-event', (_a, event) => {
        if (event.get_key_symbol() === Clutter.KEY_Escape)
            close();
        return Clutter.EVENT_STOP;
    });
    Main.uiGroup.add_child(shade);
    grab = Main.pushModal(shade);
    return {close};
}
