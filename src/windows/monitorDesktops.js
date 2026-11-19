import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SWITCH_KEYS = ['left', 'right', 'up', 'down', 'last', ...Array.from({length: 12}, (_v, i) => String(i + 1))];
const BINDINGS = [...SWITCH_KEYS.map(k => `switch-to-workspace-${k}`), ...SWITCH_KEYS.map(k => `move-to-workspace-${k}`)];
const MODES = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
const POPUP_MS = 900;

/**
 * Separate desktops for every monitor. GNOME has one set of desktops for the whole screen: switching moves every
 * monitor. With this on:
 *  - GNOME is told to switch desktops only on the main monitor ("workspaces only on primary"), so its own keys,
 *    gestures, the overview and the dock keep working there and the other monitors no longer move with it;
 *  - every other monitor gets desktops of its own, kept here: each window sits on one desktop of its monitor and the
 *    windows of the other desktops of that monitor are minimised;
 *  - GNOME's desktop keys (Super+Page Up/Down, Ctrl+Alt+arrows, Super+1 ..., and moving a window with Shift) act on
 *    the monitor you are working on: the main one switches GNOME's desktops, another one its own.
 * One instance for the whole shell (services.desktops); it follows the `desktops-per-monitor` setting.
 */
export class MonitorDesktops {
    /** @param {{gsettings: Gio.Settings|null}} options */
    constructor({gsettings}) {
        this._gsettings = gsettings;
        this._mutter = new Gio.Settings({schema_id: 'org.gnome.mutter'});
        this._current = new Map();     // monitor index -> desktop index (other monitors than the main one)
        this._desktop = new WeakMap(); // window -> desktop index (on its monitor)
        this._monitorOf = new WeakMap();
        this._hidden = new Set();      // windows this class minimised
        this._busy = false;
        this._enabled = false;
        this._listeners = new Set();
        this._popup = null;
        this._popupTimer = 0;
        this._gsettings?.connectObject('changed::desktops-per-monitor', () => this._sync(), this);
        this._sync();
    }

    get enabled() {
        return this._enabled;
    }

    /** @param {() => void} callback called when a monitor switched or a window moved; @returns {() => void} to stop */
    watch(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    _changed() {
        for (const callback of this._listeners) {
            try {
                callback();
            } catch (e) {
                console.warn(`[osmin] desktops: ${e.message}`);
            }
        }
    }

    _sync() {
        const want = !!this._gsettings?.get_boolean('desktops-per-monitor');
        if (want && !this._enabled)
            this._enable();
        else if (!want && this._enabled)
            this._disable();
        else if (!want)
            this._restoreOnlyPrimary();     // switched off while Osmin was not running
    }

    _restoreOnlyPrimary() {
        if (!this._gsettings?.get_boolean('desktops-set-only-primary'))
            return;
        this._gsettings.set_boolean('desktops-set-only-primary', false);
        this._mutter.set_boolean('workspaces-only-on-primary', false);
    }

    _enable() {
        this._enabled = true;
        // GNOME switches only the main monitor; the windows of the others stay on every GNOME desktop.
        // (remembered in a setting, so it is given back even after a restart in between)
        if (!this._mutter.get_boolean('workspaces-only-on-primary')) {
            this._gsettings?.set_boolean('desktops-set-only-primary', true);
            this._mutter.set_boolean('workspaces-only-on-primary', true);
        }
        global.display.connectObject('window-created', (_d, window) => this._track(window), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._apply(), this);
        for (const window of this._windows())
            this._track(window);
        for (const name of BINDINGS)
            Main.wm.setCustomKeybindingHandler(name, MODES, (display, window, event, binding) => this._onKey(display, window, event, binding));
        this._changed();
    }

    _disable() {
        this._enabled = false;
        for (const name of BINDINGS)
            Main.wm.setCustomKeybindingHandler(name, MODES, Main.wm._showWorkspaceSwitcher.bind(Main.wm));
        global.display.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        for (const window of this._windows())
            window.disconnectObject(this);
        // Put every window back.
        for (const window of [...this._hidden]) {
            if (!window.is_destroyed?.())
                window.unminimize();
        }
        this._hidden.clear();
        this._current.clear();
        this._restoreOnlyPrimary();
        this._hidePopup();
        this._changed();
    }

    destroy() {
        this._gsettings?.disconnectObject(this);
        if (this._enabled)
            this._disable();
        this._listeners.clear();
    }

    get monitorCount() {
        return Main.layoutManager.monitors.length;
    }

    get primary() {
        return Main.layoutManager.primaryIndex;
    }

    /** Whether this monitor's desktops are kept here (every monitor but the main one, while this is on). */
    ownsMonitor(monitor) {
        return this._enabled && monitor >= 0 && monitor !== this.primary && monitor < this.monitorCount;
    }

    /**
     * The monitor you are working on: the one under the pointer (as GNOME decides where the overview and new windows
     * go). Not the focused window's: after a switch on the main monitor GNOME gives the focus to a window of another
     * monitor (it is on every GNOME desktop), and the next key would go there.
     */
    activeMonitor() {
        return global.display.get_current_monitor();
    }

    current(monitor) {
        return this._current.get(monitor) ?? 0;
    }

    /** How many desktops a monitor shows: up to the last one in use, and one empty one after it. */
    count(monitor) {
        let last = this.current(monitor);
        for (const window of this._windows()) {
            if (window.get_monitor() === monitor)
                last = Math.max(last, this._desktopOf(window));
        }
        return Math.max(2, last + 2);
    }

    windowsOn(monitor, desktop) {
        return this._windows().filter(w => w.get_monitor() === monitor && this._desktopOf(w) === desktop);
    }

    switchTo(monitor, desktop, {popup = false} = {}) {
        desktop = Math.max(0, Math.min(desktop, this.count(monitor) - 1));
        this._current.set(monitor, desktop);
        this._apply();
        // The window on top of that desktop gets the focus (or nothing of the desktop you left keeps it).
        const top = this._windows().find(w => w.get_monitor() === monitor && this._desktopOf(w) === desktop && !w.minimized);
        if (top)
            top.activate(global.get_current_time());
        if (popup)
            this._showPopup(monitor);
        this._changed();
    }

    /** One desktop on (+1) or back (-1) on a monitor of its own. */
    step(monitor, by) {
        this.switchTo(monitor, this.current(monitor) + by, {popup: true});
    }

    /** Sends a window to a desktop of its monitor and goes there. */
    moveWindow(window, desktop, {popup = false} = {}) {
        const monitor = window.get_monitor();
        desktop = Math.max(0, Math.min(desktop, this.count(monitor) - 1));
        this._desktop.set(window, desktop);
        this._current.set(monitor, desktop);
        this._apply();
        window.activate(global.get_current_time());
        if (popup)
            this._showPopup(monitor);
        this._changed();
    }

    /** Sends a window to a desktop of its monitor without going there (it is put away when that is not shown). */
    sendWindow(window, desktop) {
        const monitor = window.get_monitor();
        desktop = Math.max(0, Math.min(desktop, this.count(monitor) - 1));
        this._desktop.set(window, desktop);
        this._apply();
        this._changed();
    }

    /** GNOME's desktop keys: on the main monitor what GNOME does, on another one its own desktops. */
    _onKey(display, window, event, binding) {
        const name = binding.get_name();
        const [action, , , target] = name.split('-');
        const monitor = action === 'move' && window ? window.get_monitor() : this.activeMonitor();
        if (!this.ownsMonitor(monitor)) {
            Main.wm._showWorkspaceSwitcher(display, window, event, binding);
            return;
        }
        if (Main.overview.visible)
            return;
        const now = this.current(monitor);
        const vertical = global.workspace_manager.layout_rows === -1;
        let next;
        if (target === 'last')
            next = this.count(monitor) - 1;
        else if (/^\d+$/.test(target))
            next = Number(target) - 1;
        else if (target === (vertical ? 'up' : 'left'))
            next = now - 1;
        else if (target === (vertical ? 'down' : 'right'))
            next = now + 1;
        else
            return;      // across the way the desktops are laid out
        if (action === 'move') {
            if (window && window.get_window_type() === Meta.WindowType.NORMAL && !window.is_always_on_all_workspaces())
                this.moveWindow(window, next, {popup: true});
        } else {
            this.switchTo(monitor, next, {popup: true});
        }
    }

    /** A small "2 of 3" in the middle of the monitor that switched, as GNOME shows on the main one. */
    _showPopup(monitor) {
        const geometry = Main.layoutManager.monitors[monitor];
        if (!geometry)
            return;
        this._hidePopup(true);
        const count = this.count(monitor);
        const now = this.current(monitor);
        const box = new St.BoxLayout({
            vertical: true,
            style: 'background-color: rgba(30,30,30,0.92); border-radius: 18px; padding: 14px 22px; spacing: 10px;',
            opacity: 0,
        });
        box.add_child(new St.Label({
            text: `Desktop ${now + 1}`,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'color: white; font-weight: bold; font-size: 15px;',
        }));
        const dots = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, style: 'spacing: 8px;'});
        for (let i = 0; i < count; i++) {
            dots.add_child(new St.Widget({
                style: `width: ${i === now ? 22 : 8}px; height: 8px; border-radius: 4px; background-color: ${i === now ? 'rgba(53,132,228,1)' : 'rgba(255,255,255,0.35)'};`,
            }));
        }
        box.add_child(dots);
        Main.uiGroup.add_child(box);
        const [, width] = box.get_preferred_width(-1);
        const [, height] = box.get_preferred_height(width);
        box.set_position(Math.round(geometry.x + (geometry.width - width) / 2), Math.round(geometry.y + (geometry.height - height) / 2));
        box.ease({opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._popup = box;
        this._popupTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POPUP_MS, () => {
            this._popupTimer = 0;
            this._hidePopup();
            return GLib.SOURCE_REMOVE;
        });
    }

    _hidePopup(now = false) {
        if (this._popupTimer)
            GLib.source_remove(this._popupTimer);
        this._popupTimer = 0;
        const box = this._popup;
        this._popup = null;
        if (!box)
            return;
        if (now) {
            box.destroy();
            return;
        }
        box.ease({opacity: 0, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onComplete: () => box.destroy()});
    }

    _windows() {
        return global.display.get_tab_list(Meta.TabList.NORMAL, null)
            .filter(w => w.get_window_type() === Meta.WindowType.NORMAL && !w.is_skip_taskbar());
    }

    _desktopOf(window) {
        if (!this._desktop.has(window))
            this._desktop.set(window, this.current(window.get_monitor()));
        return this._desktop.get(window);
    }

    _track(window) {
        if (window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        this._monitorOf.set(window, window.get_monitor());
        window.connectObject(
            'notify::minimized', () => this._onMinimized(window),
            'position-changed', () => this._onMoved(window),
            'unmanaged', () => {
                this._hidden.delete(window);
                this._changed();
            },
            this);
        // A window that opens on a monitor belongs to the desktop the monitor shows now.
        if (!this._desktop.has(window))
            this._desktop.set(window, this.current(window.get_monitor()));
    }

    _onMoved(window) {
        const monitor = window.get_monitor();
        if (this._monitorOf.get(window) === monitor)
            return;
        // Dragged to another monitor: it lands on the desktop that monitor shows.
        this._monitorOf.set(window, monitor);
        this._desktop.set(window, this.current(monitor));
        this._hidden.delete(window);
        this._changed();
    }

    _onMinimized(window) {
        // A window we put away that the user brought back (Alt+Tab, the dock) takes its monitor to its desktop.
        if (this._busy || window.minimized || !this._hidden.has(window))
            return;
        this._hidden.delete(window);
        const monitor = window.get_monitor();
        if (this.ownsMonitor(monitor)) {
            this._current.set(monitor, this._desktopOf(window));
            this._apply();
            this._showPopup(monitor);
        }
        this._changed();
    }

    _apply() {
        this._busy = true;
        try {
            for (const window of this._windows()) {
                const monitor = window.get_monitor();
                // The main monitor is GNOME's: what was put away when it was another monitor comes back.
                const here = !this.ownsMonitor(monitor) || this._desktopOf(window) === this.current(monitor);
                if (here && this._hidden.has(window)) {
                    this._hidden.delete(window);
                    window.unminimize();
                } else if (!here && !window.minimized && !window.is_always_on_all_workspaces()) {
                    this._hidden.add(window);
                    window.minimize();
                }
            }
        } finally {
            this._busy = false;
        }
    }
}
