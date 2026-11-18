import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as AltTab from 'resource:///org/gnome/shell/ui/altTab.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {actionOf, gestureMap} from './catalog.js';
import {GestureRecognizer} from './recognizer.js';

const SWITCH_STEP = 70;                 // the fingers move this much (unaccelerated) from one app to the next
const PHASES = {
    [Clutter.TouchpadGesturePhase.BEGIN]: 'begin',
    [Clutter.TouchpadGesturePhase.UPDATE]: 'update',
    [Clutter.TouchpadGesturePhase.END]: 'end',
    [Clutter.TouchpadGesturePhase.CANCEL]: 'cancel',
};
const TYPES = {
    [Clutter.EventType.TOUCHPAD_SWIPE]: 'swipe',
    [Clutter.EventType.TOUCHPAD_PINCH]: 'pinch',
    [Clutter.EventType.TOUCHPAD_HOLD]: 'hold',
};
const MODIFIERS = {
    control: Clutter.KEY_Control_L, primary: Clutter.KEY_Control_L, ctrl: Clutter.KEY_Control_L,
    shift: Clutter.KEY_Shift_L, alt: Clutter.KEY_Alt_L, super: Clutter.KEY_Super_L,
};

/** "<Control><Shift>t" -> {mods: [keyvals], key: keyval} for the virtual keyboard; null when a name is unknown. */
export function keysOf(accel) {
    const mods = [];
    let ok = true;
    const name = accel.replace(/<([^>]+)>/g, (_m, mod) => {
        const keyval = MODIFIERS[mod.toLowerCase()];
        if (keyval)
            mods.push(keyval);
        else
            ok = false;
        return '';
    }).trim();
    const key = Clutter[`KEY_${name.replace(/^XF86/, '')}`] ?? Clutter[`KEY_${name}`];
    return ok && key ? {mods, key} : null;
}

/**
 * Touchpad gestures everywhere (not only over the capsule): three and four fingers swiping, pinching and resting, each
 * with the action chosen in the settings (see catalog.js). Two fingers stay with the apps. GNOME's own three- and
 * four-finger gestures are done here too, through GNOME's own trackers (the workspaces and the overview follow the
 * fingers exactly as before), so a gesture is never done twice. Only on the desktop: in the overview, a menu or the lock
 * screen, GNOME keeps its gestures.
 */
export class GestureService {
    /** @param {{gsettings: Gio.Settings, run: (action: string) => void}} params run: an action of Osmin's own */
    constructor({gsettings, run}) {
        this._gsettings = gsettings;
        this._run = run;
        this._touchpad = new Gio.Settings({schema_id: 'org.gnome.desktop.peripherals.touchpad'});
        this._recognizer = new GestureRecognizer({
            resolve: id => actionOf(this._map()[id]),
            live: (id, action, info) => this._live(id, action, info),
            once: (id, action, time) => this._once(id, action, time),
        }, () => this._gsettings.get_int('gesture-sensitivity'));
        this._lastEvent = '';
        this._minimized = [];
        this._keyboard = null;
        this._stageId = global.stage.connect('captured-event', (_actor, event) => this._onEvent(event));
    }

    destroy() {
        if (this._stageId)
            global.stage.disconnect(this._stageId);
        this._stageId = 0;
        this._recognizer.reset();
        this._keyboard?.run_dispose();
        this._keyboard = null;
    }

    _map() {
        let saved = {};
        try {
            saved = this._gsettings.get_value('gesture-actions').deepUnpack();
        } catch (e) {
            // the defaults
        }
        return gestureMap(saved);
    }

    _onEvent(event) {
        const type = TYPES[event.type()];
        if (!type)
            return Clutter.EVENT_PROPAGATE;
        // The stage and an open switcher (it holds the grab) may both pass the same event on.
        const phase = PHASES[event.get_gesture_phase()];
        const [dx, dy] = type === 'hold' ? [0, 0] : event.get_gesture_motion_delta_unaccelerated();
        const scale = type === 'pinch' ? event.get_gesture_pinch_scale() : 1;
        const key = `${type}|${phase}|${event.get_time()}|${dx}|${dy}|${scale}`;
        if (key === this._lastEvent)
            return Clutter.EVENT_STOP;
        this._lastEvent = key;

        if (phase === 'begin' && (!this._gsettings.get_boolean('touchpad-gestures') || Main.actionMode !== Shell.ActionMode.NORMAL)) {
            this._recognizer.reset();
            return Clutter.EVENT_PROPAGATE;
        }
        const fingers = event.get_touchpad_gesture_finger_count();
        const taken = this._recognizer.handle({type, phase, fingers, dx, dy, scale, time: event.get_time()});
        return taken ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    }

    // --- following the fingers -------------------------------------------------------------------------

    _live(id, action, info) {
        try {
            if (action.id === 'app-switcher' || action.id === 'window-switcher')
                return this._switcher(action.id, info);
            if (action.id === 'workspaces' || action.id === 'overview')
                return this._native(action.id, info);
        } catch (e) {
            console.warn(`[osmin] gestures: ${action.id}: ${e.message}`);
        }
        return null;     // then it is done once, when the fingers went far enough (see _once)
    }

    /**
     * GNOME's Alt+Tab, held open by the fingers instead of the Alt key: moving on goes to the next app, moving back to
     * the one before; lifting the fingers opens the chosen one.
     */
    _switcher(kind, info) {
        const popup = kind === 'app-switcher' ? new AltTab.AppSwitcherPopup() : new AltTab.WindowSwitcherPopup();
        if (!popup.show(false, kind === 'app-switcher' ? 'switch-applications' : 'switch-windows', 0)) {
            popup.destroy();
            return null;
        }
        // The switcher holds the grab while it is open: the rest of the gesture reaches it, not the stage.
        popup.connect('captured-event', (_actor, event) => this._onEvent(event));
        let gone = false;
        popup.connect('destroy', () => {
            gone = true;
            this._recognizer.reset();
        });
        const first = popup._selectedIndex;
        let moved = 0;
        const step = SWITCH_STEP * 100 / Math.max(25, this._gsettings.get_int('gesture-sensitivity') || 100);
        return {
            update: delta => {
                if (gone)
                    return;
                popup._resetNoModsTimeout();
                moved += delta * info.sign;
                const count = popup._items.length;
                // a whole step before the next one, either way (a small wobble of the fingers changes nothing)
                const index = (((first + Math.trunc(moved / step)) % count) + count) % count;
                if (index !== popup._selectedIndex)
                    popup._select(index);
            },
            end: (time, cancelled) => {
                if (gone)
                    return;
                gone = true;
                // The chosen window is opened here (as the switcher would; its app-level activation does not always
                // take the focus when nothing was typed), then the switcher goes.
                const item = popup._items[popup._selectedIndex];
                const window = item?.window ?? item?.cachedWindows?.[Math.max(0, popup._currentWindow ?? 0)];
                popup.fadeAndDestroy();
                if (!cancelled && window)
                    Main.activateWindow(window, time || global.get_current_time());
            },
        };
    }

    /** GNOME's own workspace and overview gestures, given the fingers' moves (they look and feel as GNOME's). */
    _native(kind, info) {
        const tracker = kind === 'workspaces' ? Main.wm._workspaceAnimation?._swipeTracker : Main.overview._swipeTracker;
        const gesture = tracker?._touchpadGesture;
        if (!gesture || !tracker.enabled || !(tracker._allowedModes & Main.actionMode))
            return null;
        const distance = info.axis === 'x' ? 400 : 300;      // GNOME's TOUCHPAD_BASE_WIDTH / HEIGHT
        const natural = this._touchpad.get_boolean('natural-scroll');
        const [x, y] = global.get_pointer();
        gesture.emit('begin', info.time, x, y);
        let ended = false;
        return {
            update: (delta, time) => !ended && gesture.emit('update', time, natural ? -delta : delta, distance),
            end: time => {
                if (!ended)
                    gesture.emit('end', time || global.get_current_time(), distance);
                ended = true;
            },
        };
    }

    // --- once ------------------------------------------------------------------------------------------

    _once(id, action, time) {
        try {
            this._do(id, action, time || global.get_current_time());
        } catch (e) {
            console.warn(`[osmin] gestures: ${action.id}: ${e.message}`);
        }
    }

    _do(id, action, time) {
        if (action.keys) {
            this._press(action.keys);
            return;
        }
        const direction = id.split('-')[1];
        const workspace = global.workspace_manager.get_active_workspace();
        const window = global.display.focus_window;
        switch (action.id) {
        case 'app-switcher':
        case 'window-switcher':
        case 'previous-app': {
            const list = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);
            if (list[1])
                Main.activateWindow(list[1], time);
            break;
        }
        case 'workspaces':
        case 'workspace-left':
        case 'workspace-right': {
            const left = action.id === 'workspace-left' || (action.id === 'workspaces' && (direction === 'right' || direction === 'down') === this._touchpad.get_boolean('natural-scroll'));
            workspace.get_neighbor(left ? Meta.MotionDirection.LEFT : Meta.MotionDirection.RIGHT).activate(time);
            break;
        }
        case 'overview':
            if (direction === 'down')
                Main.overview.hide();
            else
                Main.overview.show();
            break;
        case 'overview-toggle':
            Main.overview.toggle();
            break;
        case 'app-grid':
            Main.overview.showApps();
            break;
        case 'show-desktop':
            this._showDesktop(workspace, time);
            break;
        case 'window-maximize':
            if (window?.is_maximized())
                window.unmaximize();
            else if (window?.can_maximize())
                window.maximize();
            break;
        case 'window-minimize':
            if (window?.can_minimize())
                window.minimize();
            break;
        case 'window-fullscreen':
            if (window?.is_fullscreen())
                window.unmake_fullscreen();
            else
                window?.make_fullscreen();
            break;
        case 'window-close':
            window?.delete(time);
            break;
        case 'notifications':
            Main.panel.statusArea.dateMenu?.menu.toggle();
            break;
        case 'quick-settings':
            Main.panel.statusArea.quickSettings?.menu.toggle();
            break;
        case 'lock':
            Main.screenShield?.lock(true);
            break;
        case 'play-pause':
        case 'next':
        case 'prev':
            this._run(action.id);
            break;
        default:
            if (action.id.startsWith('osmin:'))
                this._run(action.id.slice(6));
        }
    }

    /** All windows of this workspace away, and back the second time (if nothing was opened in between). */
    _showDesktop(workspace, time) {
        const windows = workspace.list_windows().filter(w => !w.minimized && !w.skip_taskbar && w.window_type === Meta.WindowType.NORMAL);
        if (windows.length > 0) {
            this._minimized = windows;
            windows.forEach(w => w.minimize());
            return;
        }
        const back = this._minimized.filter(w => w.get_workspace?.() === workspace);
        this._minimized = [];
        back.forEach(w => w.unminimize());
        back.at(-1)?.activate(time);
    }

    /** A keyboard shortcut, pressed by a virtual keyboard (the focused app gets it as if it was typed). */
    _press(accel) {
        const keys = keysOf(accel);
        if (!keys) {
            console.warn(`[osmin] gestures: unknown keys ${accel}`);
            return;
        }
        this._keyboard ??= Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        let t = GLib.get_monotonic_time();
        const send = (keyval, state) => this._keyboard.notify_keyval(t++, keyval, state);
        keys.mods.forEach(m => send(m, Clutter.KeyState.PRESSED));
        send(keys.key, Clutter.KeyState.PRESSED);
        send(keys.key, Clutter.KeyState.RELEASED);
        [...keys.mods].reverse().forEach(m => send(m, Clutter.KeyState.RELEASED));
    }
}
