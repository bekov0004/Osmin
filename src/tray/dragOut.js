import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

const HELPER = GLib.build_filenamev([
    GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]), '..', 'helpers', 'dragout.js',
]);
const WINDOW_TITLE = 'OsminDragOut';
const WINDOW_SIZE = 64;
const HANDOFF_DELAY_MS = 120;     // a window that has only just been mapped: time to draw and be stacked
const ARMED_DELAY_MS = 25;        // a window that already waits under the pointer: one frame
const DISARM_MS = 250;            // leaving a file: it may be on its way to the next one
const TOUCH_SETTLE_MS = 400;      // a new touch device must be announced to the clients before it is used
const BUTTON1 = Clutter.ModifierType.BUTTON1_MASK;

// Watchdogs: whatever goes wrong, the capsule is back and the input is released
// after at most this long.
const WINDOW_TIMEOUT_MS = 1500;   // the helper's window must appear
const START_TIMEOUT_MS = 1500;    // after the touch, the drag must start
const DWELL_MS = 120;             // over the target before the finger lifts (a drop needs a moment)
const LATE_START_MS = 700;        // the mouse is already up: how long to wait for the drag to start, then drop
const END_TIMEOUT_MS = 2500;      // after the finger lifts, the helper must report the end
const MAX_DRAG_MS = 90000;        // no drag lasts longer than this
const HIDE_TIMEOUT_MS = 1200;     // after a drag the helper must have unmapped its window

const Phase = Object.freeze({
    IDLE: 'idle',
    PRESSED: 'pressed',     // the mouse is down on a file, nothing started yet
    WINDOW: 'window',       // waiting for the helper's window to appear
    TOUCH: 'touch',         // the virtual finger is down, waiting for the drag to start
    DRAGGING: 'dragging',   // the helper reported that the drag is running
});

/**
 * Lets files be dragged out of the tray into other applications.
 *
 * A shell extension cannot start a Wayland drag itself, so a tiny helper
 * process (helpers/dragout.js) owns the drag. The helper is started when the
 * pointer first rests on a file and stays warm, talking over stdin / stdout; when
 * the pointer has moved far enough with the mouse down, its window is put under the
 * pointer and a virtual finger touches it, which makes the helper start a normal drag.
 * The capsule hides meanwhile.
 *
 * The helper is a separate process and the virtual finger is a fake input device, so
 * everything here is defensive: every step re-checks that the mouse button is still
 * down, every wait has a timeout, and however a drag ends the finger is lifted, the
 * helper's window is hidden and the capsule is brought back.
 */
export class DragOutService {
    /** @param {{onBegin: Function, onEnd: Function}} hooks */
    constructor({onBegin, onEnd}) {
        this._onBegin = onBegin;
        this._onEnd = onEnd;
        this._phase = Phase.IDLE;
        this._busy = false;
        this._uris = null;
        this._armed = false;
        this._armUris = null;
        this._armCheck = null;
        this._focusBefore = null;
        this._trackId = 0;
        this._lastPlaced = [NaN, NaN];

        this._proc = null;
        this._stdin = null;
        this._reader = null;
        this._readCancellable = null;
        this._mapId = 0;
        this._window = null;
        this._windowUnmanagedId = 0;

        this._touch = null;
        this._touchCreatedAt = 0;
        this._touchDown = false;
        this._nudgeId = 0;
        this._nudgeCount = 0;
        this._releaseSeen = false;
        this._followId = 0;
        this._timeouts = new Set();
        this._timers = new Map();
        this._destroyed = false;
    }

    /** True while a drag is being handed over or running (the capsule is hidden). */
    get busy() {
        return this._busy;
    }

    /** The pointer rests on a file: get the helper ready (cheap when it already is). */
    warm() {
        if (this._destroyed || this._proc)
            return;
        try {
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE |
                    Gio.SubprocessFlags.STDERR_SILENCE,
            });
            // Software rendering only: a window of 140 px must never touch the GPU.
            launcher.setenv('GSK_RENDERER', 'cairo', true);
            launcher.setenv('GDK_DISABLE', 'gl,vulkan,dmabuf,offload', true);
            this._proc = launcher.spawnv(['gjs', '-m', HELPER]);
        } catch (e) {
            console.warn(`[osmin] drag out unavailable: ${e.message}`);
            this._proc = null;
            return;
        }
        const proc = this._proc;
        // The virtual touchscreen is created now, long before it is needed: the compositor
        // has to announce the new device to the clients, and a touch sent at once is lost.
        this._ensureTouch();
        this._stdin = proc.get_stdin_pipe();
        this._reader = new Gio.DataInputStream({base_stream: proc.get_stdout_pipe()});
        this._readCancellable = new Gio.Cancellable();
        this._readNext(proc);
        proc.wait_async(null, () => this._helperGone(proc));
        this._mapId = global.window_manager.connect('map', (_wm, actor) => this._onMap(actor.meta_window));
    }

    /**
     * The pointer rests on a file: put the helper's (invisible) window under the pointer
     * and keep it there, so that a quick pull out of the tray only has to touch it.
     * Called again with every move over the file; cheap when nothing changed.
     */
    arm(uris, stillOver = null) {
        if (this._destroyed || this._busy)
            return;
        this.warm();
        if (!this._proc)
            return;
        this._clearTimer('disarm');
        this._armCheck = stillOver;
        const same = this._armed && this._armUris?.join('\n') === uris.join('\n');
        if (!same) {
            if (!this._armed)
                this._focusBefore = global.display.focus_window;
            this._armUris = uris;
            this._armed = true;
            this._send({cmd: 'show', uris});
        }
        this._startTracking();
    }

    /** The pointer left a file (it may be on its way to the next one). */
    disarm() {
        if (this._busy || !this._armed)
            return;
        this._timer('disarm', DISARM_MS, () => this._disarmNow());
    }

    _disarmNow() {
        this._clearTimer('disarm');
        this._stopTracking();
        if (!this._armed || this._busy)
            return;
        this._armed = false;
        this._armUris = null;
        this._send({cmd: 'hide'});
    }

    _startTracking() {
        if (this._trackId)
            return;
        this._trackId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
            if (!this._armed || this._busy || !this._window) {
                if (!this._armed || this._busy)
                    this._trackId = 0;
                return this._armed && !this._busy ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
            }
            if (this._armCheck && !this._armCheck()) {
                // The pointer is no longer on the file (a hover that was never reported as lost).
                this._armCheck = null;
                this.disarm();
                return GLib.SOURCE_CONTINUE;
            }
            const [x, y] = global.get_pointer();
            const [lx, ly] = this._lastPlaced;
            if (!(Math.abs(x - lx) < 2 && Math.abs(y - ly) < 2)) {
                this._lastPlaced = [x, y];
                this._placeWindow();
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTracking() {
        if (this._trackId) {
            GLib.source_remove(this._trackId);
            this._trackId = 0;
        }
    }

    /** The mouse went down on a file. */
    prepare(uris) {
        if (this._destroyed || this._busy)
            return;
        this._uris = uris;
        this._phase = Phase.PRESSED;
        this.warm();
    }

    /** The pointer moved far enough with the mouse down: start the real drag. */
    begin() {
        if (this._destroyed || this._phase !== Phase.PRESSED || !this._uris)
            return;
        if (!this._proc || !this._buttonDown()) {
            this._phase = Phase.IDLE;
            return;
        }
        this._phase = Phase.WINDOW;
        this._busy = true;
        this._stopTracking();
        this._clearTimer('disarm');
        this._onBegin();
        this._timer('abandon', MAX_DRAG_MS, () => this._finish('the drag took too long'));
        if (this._armed && this._window && this._armUris?.join('\n') === this._uris.join('\n')) {
            // The window already waits under the pointer: no time lost.
            this._handoff(ARMED_DELAY_MS);
            return;
        }
        this._armed = true;
        this._armUris = this._uris;
        this._send({cmd: 'show', uris: this._uris});
        this._timer('window', WINDOW_TIMEOUT_MS, () => this._finish('the helper window did not appear'));
    }

    /** The mouse went up before a drag started. */
    cancel() {
        if (this._busy)
            return;
        this._phase = Phase.IDLE;
        this._uris = null;
    }

    destroy() {
        this._destroyed = true;
        this._finish('destroyed');
        this._stopHelper();
    }

    // --- helper process ---------------------------------------------------

    _send(message) {
        if (!this._stdin)
            return;
        const bytes = new TextEncoder().encode(`${JSON.stringify(message)}\n`);
        try {
            this._stdin.write_all_async(bytes, GLib.PRIORITY_DEFAULT, null, (stream, result) => {
                try {
                    stream.write_all_finish(result);
                } catch (e) {
                    // The helper is gone; _helperGone() cleans up.
                }
            });
        } catch (e) {
            console.debug(`[osmin] drag out: could not write to the helper: ${e.message}`);
        }
    }

    _readNext(proc) {
        const reader = this._reader;
        reader.read_line_async(GLib.PRIORITY_DEFAULT, this._readCancellable, (stream, result) => {
            let line = null;
            try {
                [line] = stream.read_line_finish_utf8(result);
            } catch (e) {
                line = null;
            }
            if (line === null || this._proc !== proc)
                return;
            this._onHelperLine(line);
            this._readNext(proc);
        });
    }

    _onHelperLine(line) {
        let message;
        try {
            message = JSON.parse(line);
        } catch (e) {
            return;
        }
        if (message.ev === 'begin' && this._busy) {
            this._phase = Phase.DRAGGING;
            this._clearTimer('start');
            this._stopNudge();
            const [x, y, mods] = global.get_pointer();
            this._move(x, y);
            if (mods & BUTTON1) {
                this._follow();
            } else {
                // The mouse went up before the drag could start: let go where the pointer is,
                // but only after a moment over it, so that the target window can take the drop.
                this._timer('end', END_TIMEOUT_MS + 400, () => this._finish('the helper did not report the end'));
                this._later(DWELL_MS, () => {
                    this._move(x + 1, y + 1);
                    this._later(DWELL_MS / 2, () => this._liftFinger());
                });
            }
        } else if (message.ev === 'end' && this._busy) {
            this._finish('the drag ended');
        }
    }

    _helperGone(proc) {
        if (this._proc !== proc)
            return;
        this._finish('the helper exited');
        this._stopHelper();
    }

    _stopHelper() {
        const proc = this._proc;
        this._proc = null;
        this._readCancellable?.cancel();
        this._readCancellable = null;
        this._reader = null;
        try {
            this._stdin?.close(null);
        } catch (e) {
            // already closed
        }
        this._stdin = null;
        if (this._mapId) {
            global.window_manager.disconnect(this._mapId);
            this._mapId = 0;
        }
        this._forgetWindow();
        if (this._touch) {
            // The virtual touchscreen goes away with its last reference: collect it now so
            // the system does not keep a touchscreen around that nobody uses any more.
            this._liftFinger();
            this._touch = null;
            try {
                System.gc();
            } catch (e) {
                // best effort
            }
        }
        if (proc) {
            try {
                proc.force_exit();
            } catch (e) {
                // already gone
            }
        }
    }

    // --- the helper's window ---------------------------------------------

    _onMap(win) {
        if (!win || win.get_title() !== WINDOW_TITLE)
            return;
        this._forgetWindow();
        this._window = win;
        this._windowUnmanagedId = win.connect('unmanaged', () => {
            this._windowUnmanagedId = 0;
            this._window = null;
        });
        if (this._phase === Phase.WINDOW) {
            this._handoff(HANDOFF_DELAY_MS);
        } else if (this._armed) {
            // Waiting under the pointer: the window must not keep the keyboard from the
            // application you were using.
            this._lastPlaced = [NaN, NaN];
            this._placeWindow();
            const previous = this._focusBefore;
            if (previous && previous !== win) {
                try {
                    previous.activate(global.get_current_time());
                } catch (e) {
                    // that window is gone
                }
            }
        }
    }

    _forgetWindow() {
        if (this._window && this._windowUnmanagedId) {
            try {
                this._window.disconnect(this._windowUnmanagedId);
            } catch (e) {
                // the window is gone
            }
        }
        this._windowUnmanagedId = 0;
        this._window = null;
    }

    _placeWindow() {
        const win = this._window;
        if (!win)
            return null;
        const [x, y] = global.get_pointer();
        try {
            win.move_frame(true, Math.round(x - WINDOW_SIZE / 2), Math.round(y - WINDOW_SIZE / 2));
        } catch (e) {
            return null;
        }
        return [x, y];
    }

    // --- handing the mouse press over to the helper ----------------------

    _buttonDown() {
        return (global.get_pointer()[2] & BUTTON1) !== 0;
    }

    /** The middle of the helper's window as the compositor has it right now, or null. */
    _windowCenter() {
        try {
            const rect = this._window?.get_frame_rect();
            if (rect && rect.width > 0 && rect.height > 0)
                return [rect.x + rect.width / 2, rect.y + rect.height / 2];
        } catch (e) {
            // the window is gone
        }
        return null;
    }

    _handoff(delay) {
        this._clearTimer('window');
        // A window that already waits under the pointer stays where it is: the pointer may be
        // far away by now (a quick flick), and the finger goes to the window, not the pointer.
        const waiting = delay === ARMED_DELAY_MS;
        if (!this._buttonDown() || (!waiting && !this._placeWindow())) {
            this._finish('the mouse was released before the hand-over');
            return;
        }
        try {
            this._window.raise();
        } catch (e) {
            this._finish('the helper window is gone');
            return;
        }
        // Give the compositor a moment to move and stack the window (and to announce a
        // touch device that was created only just now).
        const touchAge = (GLib.get_monotonic_time() - this._touchCreatedAt) / 1000;
        this._later(Math.max(delay, TOUCH_SETTLE_MS - touchAge), () => {
            if (this._phase !== Phase.WINDOW)
                return;
            const spot = !this._buttonDown() ? null : waiting ? this._windowCenter() : this._placeWindow();
            if (!spot) {
                this._finish('the mouse was released before the hand-over');
                return;
            }
            const touch = this._ensureTouch();
            if (!touch) {
                this._finish('no virtual touch device');
                return;
            }
            // A touch, not a button: the mouse button is already held down (the shell saw
            // that press), and the compositor ignores a second press. A virtual finger that
            // follows the pointer is a fresh press the helper can drag from.
            const [px, py] = spot;
            touch.notify_touch_down(GLib.get_monotonic_time(), 0, px, py);
            this._touchDown = true;
            this._phase = Phase.TOUCH;
            this._timer('start', START_TIMEOUT_MS, () => this._finish('the drag did not start'));
            this._nudgeCount = 0;
            this._releaseSeen = false;
            this._nudge(px, py);
        });
    }

    /**
     * The drag has to start while the finger is still on the window, and the helper's GTK
     * needs a few small moves to see it: shake the finger a little, one step a frame, until
     * the helper reports that the drag has begun. Only then does the finger go to wherever
     * the pointer has got to (a quick flick is far away by now).
     */
    _nudge(px, py) {
        this._nudgeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            if (!this._touchDown || this._phase !== Phase.TOUCH) {
                this._nudgeId = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (!this._releaseSeen && !this._buttonDown()) {
                // The mouse is already up (a quick flick): the drag may still start, then drop.
                this._releaseSeen = true;
                this._timer('start', LATE_START_MS, () => this._finish('the drag did not start'));
            }
            const step = Math.min(++this._nudgeCount * 5, 25);
            const wobble = this._nudgeCount % 2 === 0 ? 1 : 0.6;
            this._move(px + step * wobble, py + step);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopNudge() {
        if (this._nudgeId) {
            GLib.source_remove(this._nudgeId);
            this._nudgeId = 0;
        }
    }

    _ensureTouch() {
        if (this._touch)
            return this._touch;
        try {
            const seat = global.stage.context.get_backend().get_default_seat();
            this._touch = seat.create_virtual_device(Clutter.InputDeviceType.TOUCHSCREEN_DEVICE);
            this._touchCreatedAt = GLib.get_monotonic_time();
        } catch (e) {
            console.warn(`[osmin] drag out: no virtual touch device: ${e.message}`);
            this._touch = null;
        }
        return this._touch;
    }

    _move(x, y) {
        if (this._touchDown && this._touch)
            this._touch.notify_touch_motion(GLib.get_monotonic_time(), 0, x, y);
    }

    /** Moves the finger with the pointer until the mouse button is let go. */
    _follow() {
        if (this._followId || !this._touchDown)
            return;
        this._followId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            if (!this._touchDown) {
                this._followId = 0;
                return GLib.SOURCE_REMOVE;
            }
            const [x, y, mods] = global.get_pointer();
            if (mods & BUTTON1) {
                this._move(x, y);
                return GLib.SOURCE_CONTINUE;
            }
            this._followId = 0;
            this._liftFinger();
            // The drop is in the compositor's hands; the helper reports the end.
            this._timer('end', END_TIMEOUT_MS, () => this._finish('the helper did not report the end'));
            return GLib.SOURCE_REMOVE;
        });
    }

    _liftFinger() {
        if (!this._touchDown)
            return;
        this._touchDown = false;
        try {
            this._touch?.notify_touch_up(GLib.get_monotonic_time(), 0);
        } catch (e) {
            console.debug(`[osmin] drag out: lifting the finger failed: ${e.message}`);
        }
    }

    // --- ending ------------------------------------------------------------

    /** However the drag ends: finger up, window hidden, capsule back. Safe to call twice. */
    _finish(reason) {
        const wasBusy = this._busy;
        this._clearTimers();
        this._stopTracking();
        this._stopNudge();
        this._armed = false;
        this._armUris = null;
        if (this._followId) {
            GLib.source_remove(this._followId);
            this._followId = 0;
        }
        this._liftFinger();
        if (wasBusy || this._phase !== Phase.IDLE)
            this._send({cmd: 'hide'});
        this._phase = Phase.IDLE;
        this._uris = null;
        this._busy = false;
        this._releaseSeen = false;
        if (wasBusy) {
            console.debug(`[osmin] drag out finished: ${reason}`);
            this._onEnd();
            // The helper should unmap its window at once. If it does not (it hangs), its
            // invisible window would keep swallowing clicks: end the helper instead.
            this._timer('verify-hidden', HIDE_TIMEOUT_MS, () => {
                if (this._window && !this._busy) {
                    console.warn('[osmin] drag out: the helper did not hide its window, restarting it');
                    this._stopHelper();
                }
            });
        }
    }

    // --- timers -------------------------------------------------------------

    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }

    _timer(name, ms, fn) {
        this._clearTimer(name);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timers.delete(name);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.set(name, id);
    }

    _clearTimer(name) {
        const id = this._timers.get(name);
        if (id) {
            GLib.source_remove(id);
            this._timers.delete(name);
        }
    }

    _clearTimers() {
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        for (const id of this._timers.values())
            GLib.source_remove(id);
        this._timers.clear();
    }
}
