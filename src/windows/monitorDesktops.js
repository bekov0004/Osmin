import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Desktops that belong to one monitor. GNOME has one set of desktops for the whole screen: switching
 * moves every monitor. This keeps its own number for every monitor instead: each window sits on one
 * desktop of its monitor, and the windows of the other desktops of that monitor are minimised. The
 * windows of the other monitors are not touched.
 */
export class MonitorDesktops {
    /** @param {() => void} onChange called when a switch or a move happened */
    constructor(onChange = () => {}) {
        this._onChange = onChange;
        this._current = new Map();   // monitor index -> desktop index
        this._desktop = new WeakMap(); // window -> desktop index (on its monitor)
        this._monitorOf = new WeakMap();
        this._hidden = new Set();    // windows this class minimised
        this._busy = false;
    }

    enable() {
        global.display.connectObject('window-created', (_d, window) => this._track(window), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._apply(), this);
        for (const window of this._windows())
            this._track(window);
    }

    disable() {
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
    }

    get monitorCount() {
        return Main.layoutManager.monitors.length;
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

    switchTo(monitor, desktop) {
        this._current.set(monitor, desktop);
        this._apply();
        this._onChange();
    }

    /** Sends a window to a desktop of its monitor and goes there. */
    moveWindow(window, desktop) {
        const monitor = window.get_monitor();
        this._desktop.set(window, desktop);
        this._current.set(monitor, desktop);
        this._apply();
        window.activate(global.get_current_time());
        this._onChange();
    }

    _windows() {
        return global.display.get_tab_list(Meta.TabList.NORMAL, null);
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
            'unmanaged', () => this._hidden.delete(window),
            this);
        // A window that opens on a monitor belongs to the desktop the monitor shows now.
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
        this._onChange();
    }

    _onMinimized(window) {
        // A window we put away that the user brought back (Alt+Tab, the dock) joins the desktop shown now.
        if (this._busy || window.minimized || !this._hidden.has(window))
            return;
        this._hidden.delete(window);
        this._desktop.set(window, this.current(window.get_monitor()));
        this._apply();
        this._onChange();
    }

    _apply() {
        this._busy = true;
        try {
            for (const window of this._windows()) {
                const monitor = window.get_monitor();
                const here = this._desktopOf(window) === this.current(monitor);
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
