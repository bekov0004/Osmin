import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {menuCard, menuChips, setChecked} from '../../ui/menuKit.js';
import {maximizeWindow, placeWindow, restoreTiled, snap, tile} from '../../windows/layout.js';
import {WindowMap} from '../../windows/windowMap.js';
import {OsminWidget} from '../widget.js';

// The buttons beside the picture: how they look is what they do.
const LEFT = [['columns', 'Columns'], ['rows', 'Rows'], ['grid', 'Grid']];
const RIGHT = [['main', 'Main + side'], ['undo', 'Undo']];

/** A small drawing of a layout: the cells of it. */
function glyph(kind) {
    const cell = () => new St.Widget({style_class: 'osmin-glyph-cell', x_expand: true, y_expand: true});
    const box = (vertical, children, extra = {}) => {
        const b = new St.BoxLayout({vertical, x_expand: true, y_expand: true, style_class: 'osmin-glyph-box', ...extra});
        children.forEach(c => b.add_child(c));
        return b;
    };
    let inner;
    switch (kind) {
    case 'columns':
        inner = box(false, [cell(), cell(), cell()]);
        break;
    case 'rows':
        inner = box(true, [cell(), cell(), cell()]);
        break;
    case 'grid':
        inner = box(true, [box(false, [cell(), cell()]), box(false, [cell(), cell()])]);
        break;
    case 'main': {
        const big = cell();
        big.x_expand = false;
        big.width = 15;
        inner = box(false, [big, box(true, [cell(), cell()])]);
        break;
    }
    default:
        return new St.Icon({icon_name: 'edit-undo-symbolic', icon_size: 16, style_class: 'osmin-glyph-icon'});
    }
    const frame = new St.Bin({style_class: 'osmin-glyph', child: inner});
    return frame;
}

/**
 * Windows: a picture of one screen with its windows, to arrange them by hand. Choose the monitor above it, and the
 * desktop with its tab (only the picture changes, not the screen); drag a window to move it (at an edge it takes half or a quarter of the screen, at the top all
 * of it), onto another desktop's tab or another monitor to send it there; click it to bring it forward, ✕ to close it.
 * The buttons beside the picture arrange all its windows at once: columns, rows, a grid, one main window with the rest
 * beside it, and undo.
 */
export class WindowsWidget extends OsminWidget {
    static id = 'windows';
    static title = 'Windows';
    static iconName = 'focus-windows-symbolic';
    static menuNative = true;

    constructor(context) {
        super(context);
        this._target = null;     // the window you were working in when the page opened
        this._monitor = null;    // the monitor shown
        this._shown = false;
        this._pending = 0;
        this._watched = new Set();
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-windows osmin-menu-page', x_expand: true});

        this._monitorRow = new St.BoxLayout({vertical: true, x_expand: true});
        root.add_child(this._monitorRow);

        const card = menuCard();
        card.add_style_class_name('osmin-winmap-card');
        this._tabs = new St.BoxLayout({style_class: 'osmin-winmap-tabs', x_expand: true});
        card.add_child(this._tabs);
        const row = new St.BoxLayout({style_class: 'osmin-winmap-row', x_expand: true});
        row.add_child(this._column(LEFT));
        this._map = new WindowMap({
            onRaise: window => this._raise(window),
            onClose: window => window.delete(global.get_current_time()),
            onMove: (window, where) => this._place(window, where),
            onDropOutside: (window, x, y) => this._dropOutside(window, x, y),
            onDragging: window => this._markDropTargets(!!window),
        });
        const mapBox = new St.Bin({style_class: 'osmin-winmap-frame', x_expand: true, child: this._map, y_align: Clutter.ActorAlign.CENTER});
        row.add_child(mapBox);
        row.add_child(this._column(RIGHT));
        card.add_child(row);
        const hint = new St.Label({
            text: 'Drag a window to an edge for half, a corner for a quarter, the top for the whole screen. Drop it on a tab or a monitor to move it there.',
            style_class: 'osmin-hint',
        });
        hint.clutter_text.line_wrap = true;
        card.add_child(hint);
        root.add_child(card);
        return root;
    }

    _column(buttons) {
        const column = new St.BoxLayout({vertical: true, style_class: 'osmin-winmap-side', y_align: Clutter.ActorAlign.CENTER});
        for (const [id, label] of buttons) {
            const content = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER});
            content.add_child(glyph(id));
            content.add_child(new St.Label({text: label, style_class: 'osmin-winmap-side-label', x_align: Clutter.ActorAlign.CENTER}));
            const button = new St.Button({style_class: 'osmin-winmap-side-button', child: content, can_focus: true, reactive: true, track_hover: true, accessible_name: label});
            button.connect('clicked', () => this._arrange(id));
            column.add_child(button);
        }
        return column;
    }

    onPageShown() {
        const focus = global.display.focus_window;
        this._target = focus && focus.get_window_type() === Meta.WindowType.NORMAL ? focus : null;
        this._monitor = this._target ? this._target.get_monitor() : global.display.get_current_monitor();
        this._viewed = null;     // the desktop shown in the picture (null: the one on the screen)
        this._shown = true;
        global.display.connectObject('window-created', () => this._soon(), 'restacked', () => this._soon(), this);
        global.workspace_manager.connectObject(
            'active-workspace-changed', () => this._soon(),
            'workspace-added', () => this._soon(),
            'workspace-removed', () => this._soon(), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._soon(), this);
        this._stopDesktops = this.context.services?.desktops?.watch(() => this._soon()) ?? null;
        this._rebuild();
    }

    onPageHidden() {
        this._shown = false;
        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        this._stopDesktops?.();
        this._stopDesktops = null;
        this._unwatchWindows();
        if (this._pending)
            GLib.source_remove(this._pending);
        this._pending = 0;
        this._map?.set({x: 0, y: 0, width: 16, height: 9}, []);
    }

    /** Builds the picture again a moment later (once for many changes; never under a dragged window). */
    _soon() {
        if (this._pending || !this._shown)
            return;
        this._pending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            this._pending = 0;
            if (this._map?.dragging)
                this._soon();
            else
                this._rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    _unwatchWindows() {
        for (const window of this._watched)
            window.disconnectObject(this);
        this._watched.clear();
    }

    // --- monitors and desktops -------------------------------------------------------------------------------

    /** The desktops of a monitor: its own (separate desktops), GNOME's, or just one (GNOME switches only the main one). */
    _desktops(monitor) {
        const own = this.context.services?.desktops;
        const normal = w => w.get_window_type() === Meta.WindowType.NORMAL && !w.is_skip_taskbar() && w.get_monitor() === monitor;
        if (own?.ownsMonitor(monitor)) {
            return {
                count: own.count(monitor),
                current: own.current(monitor),
                windowsOn: d => own.windowsOn(monitor, d).filter(normal),
                send: (window, d) => own.sendWindow(window, d),
            };
        }
        const manager = global.workspace_manager;
        if (Meta.prefs_get_workspaces_only_on_primary() && monitor !== Main.layoutManager.primaryIndex) {
            return {
                count: 1, current: 0,
                windowsOn: () => global.display.get_tab_list(Meta.TabList.NORMAL, null).filter(normal),
                send: () => {},
            };
        }
        return {
            count: manager.get_n_workspaces(),
            current: manager.get_active_workspace_index(),
            windowsOn: d => manager.get_workspace_by_index(d)?.list_windows().filter(normal) ?? [],
            send: (window, d) => window.change_workspace_by_index(d, false),
        };
    }

    _monitorName(index) {
        const displays = this.context.services?.displays;
        const monitor = Main.layoutManager.monitors[index];
        let name = `Monitor ${index + 1}`;
        if (displays?.state && monitor) {
            for (const logical of global.backend.get_monitor_manager().get_logical_monitors()) {
                if (logical.get_number() === index)
                    name = displays.nameOf(logical.get_monitors()[0].get_connector());
            }
        }
        return index === Main.layoutManager.primaryIndex ? `${name} (main)` : name;
    }

    _rebuild() {
        if (!this._map || !this._shown)
            return;
        const monitors = Main.layoutManager.monitors;
        this._monitor = Math.max(0, Math.min(this._monitor ?? 0, monitors.length - 1));
        const monitor = this._monitor;

        this._monitorRow.destroy_all_children();
        this._monitorChips = new Map();
        if (monitors.length > 1) {
            const items = monitors.map((_m, i) => ({id: String(i), label: this._monitorName(i), icon: 'video-display-symbolic'}));
            const {actor, buttons} = menuChips(items, id => {
                this._monitor = Number(id);
                this._viewed = null;
                this._rebuild();
            }, {perRow: 2});
            actor.add_style_class_name('osmin-card-pad');
            buttons.forEach((chip, id) => setChecked(chip, Number(id) === monitor));
            this._monitorChips = new Map([...buttons].map(([id, chip]) => [Number(id), chip]));
            this._monitorRow.add_child(actor);
        }

        const desktops = this._desktops(monitor);
        const viewed = this._viewedDesktop(desktops);
        this._tabs.destroy_all_children();
        this._tabButtons = [];
        this._tabs.visible = desktops.count > 1;
        for (let d = 0; d < desktops.count; d++) {
            const n = desktops.windowsOn(d).length;
            const tab = new St.Button({style_class: 'osmin-winmap-tab', can_focus: true, reactive: true, track_hover: true, x_expand: true});
            const content = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER});
            // the desktop on the screen now has a dot
            if (d === desktops.current)
                content.add_child(new St.Widget({style_class: 'osmin-winmap-tab-dot', y_align: Clutter.ActorAlign.CENTER}));
            content.add_child(new St.Label({text: `Desktop ${d + 1}`, y_align: Clutter.ActorAlign.CENTER}));
            content.add_child(new St.Label({text: n ? ` · ${n}` : ' · empty', style_class: 'osmin-winmap-tab-count', y_align: Clutter.ActorAlign.CENTER}));
            tab.set_child(content);
            setChecked(tab, d === viewed);
            // only the picture changes: the desktops on the screen stay as they are
            tab.connect('clicked', () => {
                this._viewed = d;
                this._soon();
            });
            this._tabs.add_child(tab);
            this._tabButtons.push(tab);
        }

        const windows = global.display.sort_windows_by_stacking(this._windowsOf(desktops, viewed));
        this._unwatchWindows();
        for (const window of windows) {
            window.connectObject('position-changed', () => this._soon(), 'size-changed', () => this._soon(), 'unmanaged', () => this._soon(), 'notify::minimized', () => this._soon(), this);
            this._watched.add(window);
        }
        this._map.set(Main.layoutManager.getWorkAreaForMonitor(monitor), windows);
    }

    // --- what the picture and the buttons do --------------------------------------------------------------

    /** The desktop shown in the picture: the one chosen with its tab, else the one on the screen. */
    _viewedDesktop(desktops) {
        if (this._viewed === null || this._viewed >= desktops.count)
            this._viewed = null;
        return this._viewed ?? desktops.current;
    }

    /**
     * The windows of a desktop the picture shows. On the screen's desktop the minimised ones are left out; on another
     * one all of them (with separate desktops Osmin keeps the windows of the other desktops minimised).
     */
    _windowsOf(desktops, desktop) {
        const own = this.context.services?.desktops?.ownsMonitor(this._monitor);
        return desktops.windowsOn(desktop).filter(w => !w.minimized || (own && desktop !== desktops.current));
    }

    _raise(window) {
        // a window of another desktop only comes forward there: the screen does not go to it
        const desktops = this._desktops(this._monitor);
        if (this._viewedDesktop(desktops) !== desktops.current) {
            window.raise();
            this._soon();
            return;
        }
        Main.activateWindow(window);
        this._target = window;
        this._soon();
    }

    /** A window let go in the picture: a zone, or where it was let go (its size kept, inside the screen). */
    _place(window, {zone, x, y}) {
        const area = Main.layoutManager.getWorkAreaForMonitor(this._monitor);
        this._target = window;
        if (zone?.id === 'maximize') {
            maximizeWindow(window);
        } else if (zone) {
            placeWindow(window, area.x + zone.x * area.width, area.y + zone.y * area.height, zone.w * area.width, zone.h * area.height);
        } else {
            const rect = window.get_frame_rect();
            const width = Math.min(rect.width, area.width);
            const height = Math.min(rect.height, area.height);
            const left = Math.max(area.x, Math.min(area.x + x * area.width, area.x + area.width - width));
            const top = Math.max(area.y, Math.min(area.y + y * area.height, area.y + area.height - height));
            placeWindow(window, left, top, width, height);
        }
        this._soon();
    }

    /** A window let go over a desktop's tab or a monitor. @returns {boolean} whether one of them took it */
    _dropOutside(window, x, y) {
        const over = actor => {
            if (!actor?.mapped)
                return false;
            const [ax, ay] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            return x >= ax && x < ax + w && y >= ay && y < ay + h;
        };
        const tab = (this._tabButtons ?? []).findIndex(over);
        if (tab >= 0) {
            this._desktops(this._monitor).send(window, tab);
            this._soon();
            return true;
        }
        for (const [index, chip] of this._monitorChips ?? []) {
            if (over(chip) && index !== window.get_monitor()) {
                window.move_to_monitor(index);
                this._monitor = index;
                this._soon();
                return true;
            }
        }
        return false;
    }

    /** While a window is dragged the tabs and monitors it can go to are marked. */
    _markDropTargets(on) {
        for (const actor of [...(this._tabButtons ?? []), ...(this._monitorChips?.values() ?? [])]) {
            if (on)
                actor.add_style_class_name('osmin-drop-target');
            else
                actor.remove_style_class_name('osmin-drop-target');
        }
    }

    _arrange(id) {
        if (id === 'undo') {
            if (!restoreTiled() && this._target && !this._target.is_destroyed?.())
                snap('restore', this._target);
            this._soon();
            return;
        }
        const desktops = this._desktops(this._monitor);
        const windows = this._windowsOf(desktops, this._viewedDesktop(desktops));
        if (!windows.length)
            return;
        const anchor = this._target && windows.includes(this._target) ? this._target : global.display.sort_windows_by_stacking(windows).at(-1);
        tile(id, anchor, windows);
        this._soon();
    }

    destroy() {
        if (this._shown)
            this.onPageHidden();
        super.destroy();
    }
}
