import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {formatTime} from 'resource:///org/gnome/shell/misc/dateUtils.js';

import {SignalTracker} from '../utils/signals.js';

/**
 * The Osmin bar: a top bar for a monitor that has none of GNOME's (every monitor but the primary one).
 *  - left: the desktops of this monitor (its own when Osmin keeps separate desktops per monitor, GNOME's otherwise);
 *    a dot switches, the free space opens the overview;
 *  - middle: the capsule of this monitor, or the date and time when it has none;
 *  - right: the items of GNOME's top bar (the readings, the Osmin button, sound, network, battery ...) as live
 *    copies; pressing one opens its own menu under it, on this monitor.
 * It hides like GNOME's bar (ui/barHider.js, its own setting).
 */
export const OsminBar = GObject.registerClass(class OsminBar extends St.Widget {
    /** @param {{monitorIndex: number, desktops: MonitorDesktops, hasCapsule: () => boolean}} options */
    _init({monitorIndex, desktops, hasCapsule}) {
        super._init({style_class: 'osmin-bar', reactive: true, layout_manager: new Clutter.BinLayout()});
        this._index = monitorIndex;
        this._desktops = desktops;
        this._hasCapsule = hasCapsule;
        this._signals = new SignalTracker();
        this._mirrors = [];

        this._left = new St.BoxLayout({style_class: 'osmin-bar-left', x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.FILL, x_expand: true});
        this._center = new St.Label({style_class: 'osmin-bar-clock', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: true});
        this._right = new St.BoxLayout({style_class: 'osmin-bar-right', x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.FILL, x_expand: true});
        this.add_child(this._left);
        this.add_child(this._center);
        this.add_child(this._right);

        this._activities = new St.Button({style_class: 'osmin-bar-desktops', can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER});
        this._dots = new St.BoxLayout({style_class: 'osmin-bar-dots'});
        this._activities.set_child(this._dots);
        this._activities.connect('clicked', () => Main.overview.toggle());
        this._left.add_child(this._activities);

        // desktops
        this._stopDesktops = desktops?.watch(() => this._syncDots()) ?? null;
        this._signals.connect(global.workspace_manager, 'active-workspace-changed', () => this._syncDots());
        this._signals.connect(global.workspace_manager, 'notify::n-workspaces', () => this._syncDots());
        this._syncDots();

        // the clock (when there is no capsule here)
        this._clock = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._syncClock();
            return GLib.SOURCE_CONTINUE;
        });
        this._syncClock();

        // GNOME's items, mirrored
        this._signals.connect(Main.panel._rightBox, 'child-added', () => this._queueMirrors());
        this._signals.connect(Main.panel._rightBox, 'child-removed', () => this._queueMirrors());
        this._mirrorsQueued = 0;
        this._queueMirrors();
        this.place();
        this._signals.connect(Main.layoutManager, 'monitors-changed', () => this.place());
        this._signals.connect(Main.layoutManager.panelBox, 'notify::height', () => this.place());
        this.connect('destroy', () => this._onDestroy());
    }

    get monitorIndex() {
        return this._index;
    }

    /** The bar's place: the top of its monitor, as tall as GNOME's bar. */
    place() {
        const monitor = Main.layoutManager.monitors[this._index];
        if (!monitor)
            return;
        this.set_position(monitor.x, monitor.y);
        this.set_size(monitor.width, Main.layoutManager.panelBox.height || Main.panel.height || 32);
    }

    /** Colour and opacity, like GNOME's bar under Osmin (Settings → Appearance → Top bar color). */
    setLook({color, opacity}) {
        const match = /^#?([0-9a-f]{6})$/i.exec(color ?? '');
        const hex = match ? match[1] : '000000';
        const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
        const alpha = Math.min(Math.max(Number(opacity) || 0, 0), 1);
        this.style = `background-color: rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)});`;
    }

    /** Whether a menu opened from this bar is open (then the bar stays out). */
    get menuOpen() {
        return this._mirrors.some(m => m.open);
    }

    // --- desktops ------------------------------------------------------------------------------------------------

    _syncDots() {
        this._dots.destroy_all_children();
        let count, current, select;
        if (this._desktops?.ownsMonitor(this._index)) {
            count = this._desktops.count(this._index);
            current = this._desktops.current(this._index);
            select = i => this._desktops.switchTo(this._index, i);
        } else {
            const manager = global.workspace_manager;
            count = manager.n_workspaces;
            current = manager.get_active_workspace_index();
            select = i => manager.get_workspace_by_index(i)?.activate(global.get_current_time());
        }
        for (let i = 0; i < count; i++) {
            const dot = new St.Button({style_class: `osmin-bar-dot${i === current ? ' active' : ''}`, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER});
            dot.connect('clicked', () => {
                select(i);
                return Clutter.EVENT_STOP;
            });
            this._dots.add_child(dot);
        }
    }

    // --- clock ---------------------------------------------------------------------------------------------------

    _syncClock() {
        const capsule = this._hasCapsule();
        this._center.visible = !capsule;
        if (capsule)
            return;
        const now = GLib.DateTime.new_now_local();
        this._center.text = `${now.format('%a %-e %b')}   ${formatTime(now, {timeOnly: true})}`;
    }

    /** A capsule came or went on this monitor. */
    syncCapsule() {
        this._syncClock();
    }

    // --- GNOME's items -------------------------------------------------------------------------------------------

    _queueMirrors() {
        if (this._mirrorsQueued)
            return;
        this._mirrorsQueued = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._mirrorsQueued = 0;
            this._buildMirrors();
            return GLib.SOURCE_REMOVE;
        });
    }

    _buildMirrors() {
        for (const mirror of this._mirrors)
            mirror.destroy();
        this._mirrors = [];
        this._right.destroy_all_children();
        // everything in the right part of GNOME's bar, in its order (also the readings, which are not in statusArea)
        const buttons = Main.panel._rightBox.get_children()
            .map(container => container._delegate ?? container.get_first_child?.())
            .filter(button => button?.menu && button.container);
        for (const button of buttons) {
            const mirror = new Mirror(button);
            this._mirrors.push(mirror);
            this._right.add_child(mirror.actor);
        }
    }

    _onDestroy() {
        this._signals.disconnectAll();
        this._stopDesktops?.();
        if (this._clock)
            GLib.source_remove(this._clock);
        if (this._mirrorsQueued)
            GLib.source_remove(this._mirrorsQueued);
        for (const mirror of this._mirrors)
            mirror.destroy();
        this._mirrors = [];
    }
});

/** One item of GNOME's top bar on the Osmin bar: a live copy of it that opens its menu here. */
class Mirror {
    constructor(button) {
        this._button = button;
        this.open = false;
        this.actor = new St.Button({style_class: 'osmin-bar-item', reactive: true, can_focus: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER});
        // exactly the size the item has on GNOME's bar: a copy of another size would be stretched
        const clone = new Clutter.Clone({source: button, x_expand: false, y_expand: false, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.START});
        const syncSize = () => {
            const [w, h] = [button.width, button.height];
            if (w > 0 && h > 0)
                clone.set_size(w, h);
        };
        this.actor.set_child(clone);
        syncSize();
        // a hidden item (a reading switched off, no battery) takes no room here either
        const syncVisible = () => (this.actor.visible = button.container.visible && button.visible);
        this._ids = [
            [button, button.connect('notify::allocation', syncSize)],
            [button.container, button.container.connect('notify::visible', syncVisible)],
            [button, button.connect('notify::visible', syncVisible)],
        ];
        syncVisible();
        this.actor.connect('button-press-event', () => {
            this._toggle();
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('key-press-event', (_a, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Return || key === Clutter.KEY_space) {
                this._toggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    /** The item's own menu, opened under this copy (the menu is the same one as on GNOME's bar). */
    _toggle() {
        const menu = this._button.menu;
        if (!menu?.toggle)
            return;
        if (menu.isOpen) {
            menu.close();
            return;
        }
        const source = menu.sourceActor;
        menu.sourceActor = this.actor;
        this.open = true;
        const id = menu.connect('open-state-changed', (_m, open) => {
            if (open)
                return;
            menu.disconnect(id);
            menu.sourceActor = source;
            this.open = false;
        });
        menu.open(true);
    }

    destroy() {
        for (const [object, id] of this._ids) {
            try {
                object.disconnect(id);
            } catch (e) {
                // already gone
            }
        }
        this._ids = [];
        this.actor.destroy();
    }
}
