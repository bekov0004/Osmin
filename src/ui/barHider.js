import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {animDuration} from '../utils/animation.js';
import {SignalTracker} from '../utils/signals.js';

/** How a bar hides: never (always there), intellihide (when a window touches it), always (until the pointer comes). */
export const HideMode = Object.freeze({NEVER: 'never', INTELLIHIDE: 'intellihide', ALWAYS: 'always'});

const PRESSURE = 60;           // px pushed against the top edge to bring the bar out
const PRESSURE_TIMEOUT = 1000;
const LEAVE_MS = 700;          // after the pointer left the bar (and the capsule), it goes away again
const WATCH_MS = 150;
const SLIDE_MS = 220;
const HOT_CORNER_GAP = 32;     // the top-left corner stays GNOME's hot corner
const WINDOW_TYPES = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG, Meta.WindowType.UTILITY];

/**
 * Whether the bar at the top of one monitor (GNOME's top bar, the Osmin bar, or just the capsule) is shown.
 * Hidden it slides up out of the screen; an application in full screen hides it too, whatever the mode.
 * It comes out when the pointer pushes against the top edge (also over a full-screen application) and stays while
 * the pointer is on it or something of it is open (the capsule, a menu), and always in the overview.
 *
 * box: the bar's actor (Main.layoutManager.panelBox, an Osmin bar) or null (a capsule alone).
 * Signal 'changed' (shown).
 */
export class BarHider extends Signals.EventEmitter {
    /**
     * @param {{monitorIndex: number, box?: St.Widget|null, mode: () => string, isBusy?: () => boolean,
     *          hoverActors?: () => Clutter.Actor[]}} options
     */
    constructor({monitorIndex, box = null, mode, isBusy = () => false, hoverActors = () => []}) {
        super();
        this._index = monitorIndex;
        this._box = box;
        this._mode = mode;
        this._isBusy = isBusy;
        this._hoverActors = hoverActors;
        this._signals = new SignalTracker();
        this._windowSignals = new Map();   // Meta.Window -> [ids]
        this._shown = true;
        this._revealed = false;
        this._queued = 0;
        this._watch = 0;
        this._leaveAt = 0;
        this._barrier = null;
        this._pressure = null;
        this._tracked = null;      // how the box was tracked by the layout manager before, to give it back

        this._takeBox();
        this._makeBarrier();

        const display = global.display;
        this._signals.connect(display, 'window-created', (_d, window) => {
            this._watchWindow(window);
            this.update();
        });
        this._signals.connect(display, 'restacked', () => this.update());
        this._signals.connect(display, 'notify::focus-window', () => this.update());
        this._signals.connect(display, 'in-fullscreen-changed', () => this.update());
        this._signals.connect(global.workspace_manager, 'active-workspace-changed', () => this.update());
        this._signals.connect(Main.overview, 'showing', () => this.update());
        this._signals.connect(Main.overview, 'hidden', () => this.update());
        this._signals.connect(Main.layoutManager, 'monitors-changed', () => {
            this._makeBarrier();
            this.update();
        });
        for (const actor of global.get_window_actors())
            this._watchWindow(actor.meta_window);
        this.update({animate: false});
    }

    get shown() {
        return this._shown;
    }

    get monitor() {
        return Main.layoutManager.monitors[this._index] ?? null;
    }

    /** Something changed (the mode, the capsule opened or closed): decide again, a moment later. */
    update({animate = true} = {}) {
        if (this._queued)
            return;
        this._queued = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._queued = 0;
            this._apply(animate);
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Comes out now (a shortcut opened the capsule, for example); it hides again once the pointer is away. */
    reveal() {
        this._revealed = true;
        this._leaveAt = 0;
        this._startWatch();
        this._apply(true);
    }

    destroy() {
        if (this._queued)
            GLib.source_remove(this._queued);
        this._queued = 0;
        this._stopWatch();
        this._signals.disconnectAll();
        for (const [window, ids] of this._windowSignals)
            ids.forEach(id => window.disconnect(id));
        this._windowSignals.clear();
        this._dropBarrier();
        this._giveBox();
    }

    // --- the decision --------------------------------------------------------------------------------------------

    _wanted() {
        const monitor = this.monitor;
        if (!monitor)
            return true;
        if (Main.overview.visible || this._isBusy())
            return true;
        if (this._revealed)
            return true;
        if (monitor.inFullscreen)
            return false;
        switch (this._mode()) {
        case HideMode.ALWAYS:
            return false;
        case HideMode.INTELLIHIDE:
            return !this._windowTouches(monitor);
        default:
            return true;
        }
    }

    /** A window on this monitor's visible desktop reaches the band of the bar. */
    _windowTouches(monitor) {
        const bottom = monitor.y + this._bandHeight();
        for (const actor of global.get_window_actors()) {
            const window = actor.meta_window;
            if (!window || !actor.visible || window.minimized || !WINDOW_TYPES.includes(window.get_window_type()))
                continue;
            if (window.get_monitor() !== this._index || !window.showing_on_its_workspace())
                continue;
            const workspace = window.get_workspace();
            if (!window.is_on_all_workspaces() && workspace && workspace !== global.workspace_manager.get_active_workspace())
                continue;
            const rect = window.get_frame_rect();
            if (rect.y < bottom && rect.y + rect.height > monitor.y && rect.x < monitor.x + monitor.width && rect.x + rect.width > monitor.x)
                return true;
        }
        return false;
    }

    _bandHeight() {
        return this._box?.height || Main.layoutManager.panelBox.height || 32;
    }

    _apply(animate) {
        const shown = this._wanted();
        if (shown !== this._shown) {
            this._shown = shown;
            this._slide(animate);
            this.emit('changed', shown);
        }
        if (this._revealed || !shown)
            this._startWatch();
    }

    _slide(animate) {
        if (!this._box)
            return;
        this._box.remove_transition('translation-y');
        this._box.ease({
            translation_y: this._shown ? 0 : -this._bandHeight(),
            opacity: this._shown ? 255 : 0,
            duration: animate ? animDuration(SLIDE_MS) : 0,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            // the space kept free for it (struts) is measured where it is: again once it is back in place
            onComplete: () => Main.layoutManager._queueUpdateRegions?.(),
        });
    }

    // --- coming out and going away again -------------------------------------------------------------------------

    _makeBarrier() {
        this._dropBarrier();
        const monitor = this.monitor;
        if (!monitor)
            return;
        this._pressure = new Layout.PressureBarrier(PRESSURE, PRESSURE_TIMEOUT, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
        this._pressure.connect('trigger', () => {
            if (!this._shown || this._revealed)
                this.reveal();
        });
        this._barrier = new Meta.Barrier({
            backend: global.backend,
            x1: monitor.x + HOT_CORNER_GAP, x2: monitor.x + monitor.width - HOT_CORNER_GAP,
            y1: monitor.y, y2: monitor.y,
            directions: Meta.BarrierDirection.POSITIVE_Y,
        });
        this._pressure.addBarrier(this._barrier);
    }

    _dropBarrier() {
        if (this._pressure) {
            if (this._barrier)
                this._pressure.removeBarrier(this._barrier);
            this._pressure.destroy();
        }
        this._barrier?.destroy();
        this._barrier = null;
        this._pressure = null;
    }

    /** While it is out because it was asked for: is the pointer still on it? */
    _startWatch() {
        if (this._watch || !this._revealed)
            return;
        this._watch = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WATCH_MS, () => {
            if (!this._revealed) {
                this._watch = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (this._pointerOnBar() || this._isBusy()) {
                this._leaveAt = 0;
                return GLib.SOURCE_CONTINUE;
            }
            const now = GLib.get_monotonic_time() / 1000;
            this._leaveAt ||= now + LEAVE_MS;
            if (now < this._leaveAt)
                return GLib.SOURCE_CONTINUE;
            this._revealed = false;
            this._leaveAt = 0;
            this._watch = 0;
            this._apply(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopWatch() {
        if (this._watch)
            GLib.source_remove(this._watch);
        this._watch = 0;
    }

    _pointerOnBar() {
        const monitor = this.monitor;
        if (!monitor)
            return false;
        const [x, y] = global.get_pointer();
        if (x < monitor.x || x >= monitor.x + monitor.width)
            return false;
        if (y <= monitor.y + this._bandHeight() + 4)
            return true;
        return this._hoverActors().some(actor => {
            if (!actor?.mapped)
                return false;
            const [ax, ay] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            return x >= ax && x < ax + w && y >= ay && y < ay + h;
        });
    }

    // --- the windows ---------------------------------------------------------------------------------------------

    _watchWindow(window) {
        if (!window || this._windowSignals.has(window))
            return;
        const ids = [
            window.connect('position-changed', () => this.update()),
            window.connect('size-changed', () => this.update()),
            window.connect('notify::minimized', () => this.update()),
            window.connect('unmanaged', () => {
                this._windowSignals.get(window)?.forEach(id => window.disconnect(id));
                this._windowSignals.delete(window);
                this.update();
            }),
        ];
        this._windowSignals.set(window, ids);
    }

    // --- the bar's place in the layout ---------------------------------------------------------------------------

    /**
     * The layout manager would keep the space of the bar free for it (struts) and hide it for full-screen
     * applications by itself; both are done here instead while a mode that hides it is chosen.
     */
    _takeBox() {
        if (!this._box)
            return;
        const layout = Main.layoutManager;
        const data = layout._trackedActors?.find(d => d.actor === this._box);
        if (!data)
            return;
        this._tracked = {affectsStruts: !!data.affectsStruts, trackFullscreen: !!data.trackFullscreen};
        this._retrack({affectsStruts: this._mode() === HideMode.NEVER, trackFullscreen: false});
    }

    /** The mode changed: whether windows keep away from the bar's band. */
    syncStruts() {
        if (!this._box || !this._tracked) {
            this.update();
            return;
        }
        this._retrack({affectsStruts: this._mode() === HideMode.NEVER, trackFullscreen: false});
        this.update();
    }

    /** Tracked again by the layout manager with other parameters (only the two it knows). */
    _retrack({affectsStruts, trackFullscreen}) {
        const layout = Main.layoutManager;
        layout._untrackActor(this._box);
        try {
            layout._trackActor(this._box, {affectsStruts, trackFullscreen});
        } catch (e) {
            console.warn(`[osmin] the bar's layout: ${e.message}`);
            layout._trackActor(this._box, {affectsStruts: true, trackFullscreen: true});
        }
    }

    _giveBox() {
        if (!this._box)
            return;
        this._box.remove_all_transitions();
        this._box.translation_y = 0;
        this._box.opacity = 255;
        if (this._tracked) {
            this._retrack(this._tracked);
            this._tracked = null;
            this._box.visible = true;
            Main.layoutManager._updateVisibility?.();
        }
    }
}
