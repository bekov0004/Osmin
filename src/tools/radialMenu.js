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

const RADIUS = 100;              // from the centre to the middle of a button
const BUTTON = 56;
const HUB = 78;
const SIZE = RADIUS * 2 + BUTTON + 36;
const OPEN_MS = 260;
const ACCENT = 'rgba(53, 132, 228, 0.95)';
const ease = (actor, props) => actor.ease({duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD, ...props});

/**
 * A wheel of the favourite actions around the pointer. It opens out of the pointer, the buttons fly out of the middle
 * one after the other; the action the pointer points at (anywhere in its slice of the wheel, not only on its button) is
 * lit, grows, and its name shows in the middle, where a small light follows the pointer around. Click (or Enter) runs
 * it; Esc, a click outside or a right click closes the wheel. Arrow keys go round.
 * @returns {{close: () => void}}
 */
export function showRadialMenu(actions, run) {
    const [px, py] = global.get_pointer();
    const x = Math.round(Math.min(Math.max(px - SIZE / 2, 0), global.stage.width - SIZE));
    const y = Math.round(Math.min(Math.max(py - SIZE / 2, 0), global.stage.height - SIZE));
    const c = SIZE / 2;
    const shade = new St.Widget({reactive: true, x: 0, y: 0, width: global.stage.width, height: global.stage.height,
        style: 'background-color: rgba(0, 0, 0, 0.18);', opacity: 0});
    const wheel = new St.Widget({
        x, y, width: SIZE, height: SIZE, opacity: 0, scale_x: 0.55, scale_y: 0.55,
        style: `border-radius: ${SIZE / 2}px; background-gradient-direction: radial;` +
            ' background-color: rgba(40, 42, 48, 0.94); background-gradient-start: rgba(40, 42, 48, 0.94); background-gradient-end: rgba(14, 15, 18, 0.96);' +
            ' border: 1px solid rgba(255, 255, 255, 0.10); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);',
    });
    wheel.set_pivot_point(0.5, 0.5);
    shade.add_child(wheel);

    // the track the buttons sit on
    const track = new St.Widget({x: c - RADIUS, y: c - RADIUS, width: RADIUS * 2, height: RADIUS * 2,
        style: `border-radius: ${RADIUS}px; border: 1px solid rgba(255, 255, 255, 0.06);`});
    wheel.add_child(track);

    // the light that follows the pointer around the middle
    const orbit = new St.Widget({width: 10, height: 10, opacity: 0,
        style: `border-radius: 5px; background-color: ${ACCENT}; box-shadow: 0 0 10px ${ACCENT};`});
    wheel.add_child(orbit);

    const hub = new St.BoxLayout({vertical: true, width: HUB, height: HUB, x: c - HUB / 2, y: c - HUB / 2,
        style: `border-radius: ${HUB / 2}px; background-color: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.08);`});
    const hubIcon = new St.Icon({icon_name: 'view-app-grid-symbolic', icon_size: 22, style: 'color: rgba(255,255,255,0.75);',
        x_align: Clutter.ActorAlign.CENTER, y_expand: true, y_align: Clutter.ActorAlign.END});
    const hubLabel = new St.Label({text: '', x_align: Clutter.ActorAlign.CENTER, y_expand: true, y_align: Clutter.ActorAlign.START,
        style: 'color: white; font-size: 9pt; font-weight: 600; margin-top: 4px; text-align: center; max-width: 72px;'});
    hubLabel.clutter_text.line_wrap = true;
    hubLabel.clutter_text.ellipsize = 3;    // Pango.EllipsizeMode.END
    hub.add_child(hubIcon);
    hub.add_child(hubLabel);
    hub.set_pivot_point(0.5, 0.5);
    wheel.add_child(hub);

    let closed = false;
    let grab = null;
    let selected = -1;
    let opening = true;              // the buttons fly out under the pointer: that is not pointing at them
    const list = actions.filter(id => RADIAL_ACTIONS[id]);
    const angleOf = i => -Math.PI / 2 + (2 * Math.PI * i) / Math.max(list.length, 1);

    const close = (after = null) => {
        if (closed)
            return;
        closed = true;
        if (grab)
            Main.popModal(grab);
        grab = null;
        shade.reactive = false;
        shade.ease({opacity: 0, duration: 160, mode: Clutter.AnimationMode.EASE_IN_QUAD});
        wheel.ease({
            scale_x: after ? 1.06 : 0.8, scale_y: after ? 1.06 : 0.8, opacity: 0,
            duration: 160, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => shade.destroy(),
        });
        if (after) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                after();
                return GLib.SOURCE_REMOVE;
            });
        }
    };

    const buttons = list.map((id, i) => {
        const angle = angleOf(i);
        const bx = c + Math.cos(angle) * RADIUS - BUTTON / 2;
        const by = c + Math.sin(angle) * RADIUS - BUTTON / 2;
        const button = new St.Button({
            reactive: true, can_focus: true, track_hover: true,
            width: BUTTON, height: BUTTON, x: bx, y: by,
            style: `border-radius: ${BUTTON / 2}px; background-color: rgba(255, 255, 255, 0.10); transition-duration: 150ms;`,
            child: new St.Icon({icon_name: RADIAL_ACTIONS[id][2], icon_size: 22, style: 'color: rgba(255,255,255,0.92);'}),
            // fly out of the middle
            translation_x: c - BUTTON / 2 - bx, translation_y: c - BUTTON / 2 - by, scale_x: 0.3, scale_y: 0.3, opacity: 0,
        });
        button.set_pivot_point(0.5, 0.5);
        button.connect('notify::hover', () => button.hover && !opening && select(i));
        button.connect('clicked', () => activate(i));
        wheel.add_child(button);
        return button;
    });

    function select(i) {
        if (i === selected || closed)
            return;
        const old = buttons[selected];
        if (old) {
            ease(old, {scale_x: 1, scale_y: 1});
            old.style = old.style.replace(/background-color: [^;]+;/, 'background-color: rgba(255, 255, 255, 0.10);').replace(/ box-shadow: [^;]+;/, '');
        }
        selected = i;
        const button = buttons[i];
        if (!button) {
            hubIcon.icon_name = 'view-app-grid-symbolic';
            hubLabel.text = '';
            return;
        }
        ease(button, {scale_x: 1.16, scale_y: 1.16});
        button.style = `${button.style.replace(/background-color: [^;]+;/, `background-color: ${ACCENT};`)} box-shadow: 0 0 16px rgba(53, 132, 228, 0.55);`;
        hubIcon.icon_name = RADIAL_ACTIONS[list[i]][2];
        hubLabel.text = RADIAL_ACTIONS[list[i]][0];
        // a little nod of the middle at every change
        hub.remove_all_transitions();
        hub.set_scale(0.92, 0.92);
        ease(hub, {scale_x: 1, scale_y: 1, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_BACK});
    }

    function activate(i) {
        const id = list[i];
        const button = buttons[i];
        if (!id || closed)
            return;
        ease(button, {scale_x: 1.35, scale_y: 1.35, duration: 140});
        close(() => run(id));
    }

    // Pointing is enough: the slice the pointer is in picks the action (outside the middle).
    shade.connect('motion-event', (_a, event) => {
        if (closed || opening)
            return Clutter.EVENT_PROPAGATE;
        const [ex, ey] = event.get_coords();
        const dx = ex - (x + c);
        const dy = ey - (y + c);
        const distance = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        orbit.set_position(c + Math.cos(angle) * (HUB / 2 + 12) - 5, c + Math.sin(angle) * (HUB / 2 + 12) - 5);
        orbit.opacity = distance > HUB / 2 ? 255 : 0;
        if (distance > HUB / 2 && distance < SIZE / 2 + 40 && list.length > 0) {
            const step = (2 * Math.PI) / list.length;
            const i = ((Math.round((angle + Math.PI / 2) / step) % list.length) + list.length) % list.length;
            select(i);
        } else if (distance <= HUB / 2) {
            select(-1);
        }
        return Clutter.EVENT_PROPAGATE;
    });
    shade.connect('button-press-event', (_a, event) => {
        if (event.get_button() === Clutter.BUTTON_SECONDARY) {
            close();
            return Clutter.EVENT_STOP;
        }
        // a button's own click runs it (see 'clicked')
        const source = event.get_source();
        if (source && buttons.some(b => b === source || b.contains(source)))
            return Clutter.EVENT_PROPAGATE;
        const [ex, ey] = event.get_coords();
        const distance = Math.hypot(ex - (x + c), ey - (y + c));
        if (distance > SIZE / 2 + 40)
            close();
        else if (distance > HUB / 2 && selected >= 0)
            activate(selected);     // anywhere in the slice of the lit action
        return Clutter.EVENT_STOP;
    });
    shade.connect('key-press-event', (_a, event) => {
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_Escape)
            close();
        else if ((key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter || key === Clutter.KEY_space) && selected >= 0)
            activate(selected);
        else if ((key === Clutter.KEY_Right || key === Clutter.KEY_Down || key === Clutter.KEY_Tab) && list.length)
            select((Math.max(selected, -1) + 1) % list.length);
        else if ((key === Clutter.KEY_Left || key === Clutter.KEY_Up) && list.length)
            select(((selected < 0 ? 0 : selected) - 1 + list.length) % list.length);
        return Clutter.EVENT_STOP;
    });

    Main.uiGroup.add_child(shade);
    grab = Main.pushModal(shade);
    // open: the wheel grows out of the pointer, the buttons follow one after the other
    shade.ease({opacity: 255, duration: OPEN_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    wheel.ease({scale_x: 1, scale_y: 1, opacity: 255, duration: OPEN_MS, mode: Clutter.AnimationMode.EASE_OUT_BACK});
    buttons.forEach((button, i) => {
        button.ease({
            translation_x: 0, translation_y: 0, scale_x: 1, scale_y: 1, opacity: 255,
            delay: 40 + i * 28, duration: OPEN_MS, mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
    });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, OPEN_MS + 40 + list.length * 28, () => {
        opening = false;
        return GLib.SOURCE_REMOVE;
    });
    return {close: () => close()};
}
