import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Where a window was before Osmin moved it, so "restore" can put it back.
const previous = new WeakMap();

/** The window the user was working in: the focused one, or the top one, never Osmin's own. */
export function targetWindow() {
    const focus = global.display.focus_window;
    if (focus && focus.get_window_type() === Meta.WindowType.NORMAL)
        return focus;
    const windows = global.display.get_tab_list(Meta.TabList.NORMAL, null);
    return windows[0] ?? null;
}

function remember(window) {
    if (!previous.has(window) && !window.is_fullscreen()) {
        const rect = window.get_frame_rect();
        previous.set(window, {x: rect.x, y: rect.y, width: rect.width, height: rect.height, maximized: window.is_maximized()});
    }
}

function place(window, x, y, width, height) {
    remember(window);
    if (window.is_maximized())
        window.unmaximize();
    window.move_resize_frame(true, Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

/** The snap actions: name -> (window) => void. All of them stay inside the window's monitor work area. */
export const ACTIONS = {
    left: w => {
        const a = w.get_work_area_current_monitor();
        place(w, a.x, a.y, a.width / 2, a.height);
    },
    right: w => {
        const a = w.get_work_area_current_monitor();
        place(w, a.x + a.width / 2, a.y, a.width / 2, a.height);
    },
    top: w => {
        const a = w.get_work_area_current_monitor();
        place(w, a.x, a.y, a.width, a.height / 2);
    },
    bottom: w => {
        const a = w.get_work_area_current_monitor();
        place(w, a.x, a.y + a.height / 2, a.width, a.height / 2);
    },
    maximize: w => {
        remember(w);
        w.maximize();
    },
    center: w => {
        const a = w.get_work_area_current_monitor();
        const rect = w.get_frame_rect();
        const width = Math.min(rect.width, a.width * 0.7);
        const height = Math.min(rect.height, a.height * 0.8);
        place(w, a.x + (a.width - width) / 2, a.y + (a.height - height) / 2, width, height);
    },
    nextMonitor: w => {
        const count = global.display.get_n_monitors();
        if (count < 2)
            return;
        remember(w);
        w.move_to_monitor((w.get_monitor() + 1) % count);
    },
    restore: w => {
        const old = previous.get(w);
        if (!old)
            return;
        previous.delete(w);
        if (w.is_maximized())
            w.unmaximize();
        w.move_resize_frame(true, old.x, old.y, old.width, old.height);
        if (old.maximized)
            w.maximize();
    },
};

/** @returns {boolean} whether there was a window to act on */
export function snap(action, window = targetWindow()) {
    if (!window || !ACTIONS[action])
        return false;
    ACTIONS[action](window);
    return true;
}

export function activate(window) {
    Main.activateWindow(window);
}
