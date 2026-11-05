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

// The windows the last tile() moved, so "put it back" can restore all of them.
let tiled = [];

/** The windows tile() arranges: normal, visible ones on the same monitor and workspace as `anchor`. */
function tileable(anchor) {
    const workspace = global.workspace_manager.get_active_workspace();
    return global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
        .filter(w => !w.minimized && !w.is_skip_taskbar() && w.get_monitor() === anchor.get_monitor());
}

/** Splits the work area into `count` cells; `perRow` is the number of cells in each row (they widen to fill it). */
function cells(area, perRow) {
    const result = [];
    const height = area.height / perRow.length;
    perRow.forEach((n, row) => {
        for (let i = 0; i < n; i++)
            result.push([area.x + i * area.width / n, area.y + row * height, area.width / n, height]);
    });
    return result;
}

/**
 * Arranges every open window of the monitor in one go, however many there are.
 * columns: side by side. rows: stacked. grid: as square as possible. main: the focused window on the
 * left (60%), the others stacked on the right.
 * @returns {number} how many windows were arranged
 */
export function tile(mode, anchor = targetWindow()) {
    if (!anchor)
        return 0;
    let windows = tileable(anchor);
    if (windows.length === 0)
        return 0;
    // Keep them where the eye expects them: top to bottom, left to right, as they are now.
    const position = w => w.get_frame_rect();
    windows.sort((a, b) => (position(a).y - position(b).y) || (position(a).x - position(b).x));
    const n = windows.length;
    const area = anchor.get_work_area_current_monitor();
    let slots;
    if (mode === 'columns') {
        slots = cells(area, [n]);
    } else if (mode === 'rows') {
        slots = cells(area, Array(n).fill(1));
    } else if (mode === 'main' && n > 1) {
        windows = [anchor, ...windows.filter(w => w !== anchor)];
        const mainWidth = area.width * 0.6;
        slots = [[area.x, area.y, mainWidth, area.height],
            ...cells({x: area.x + mainWidth, y: area.y, width: area.width - mainWidth, height: area.height}, Array(n - 1).fill(1))];
    } else {
        const columns = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / columns);
        const perRow = Array(rows).fill(columns);
        perRow[rows - 1] = n - columns * (rows - 1);
        slots = cells(area, perRow);
    }
    windows.forEach((w, i) => place(w, ...slots[i]));
    tiled = windows;
    return n;
}

/** Puts the windows of the last tile() back where they were. @returns {boolean} whether there were any */
export function restoreTiled() {
    const windows = tiled.filter(w => !w.is_destroyed?.() && previous.has(w));
    tiled = [];
    windows.forEach(w => ACTIONS.restore(w));
    return windows.length > 0;
}

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
