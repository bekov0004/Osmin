import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

const HELPER = GLib.build_filenamev([
    GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]), '..', 'helpers', 'dragout.js',
]);
const WINDOW_TITLE = 'OsminDragOut';
const WINDOW_SIZE = 140;
const HANDOFF_DELAY_MS = 120;     // after the window is mapped: time to draw and be stacked
const TOUCH_SETTLE_MS = 400;      // a new touch device must be announced to the clients before it is used
const BUTTON1 = Clutter.ModifierType.BUTTON1_MASK;

// Watchdogs: whatever goes wrong, the capsule is back and the input is released
// after at most this long.
const WINDOW_TIMEOUT_MS = 1500;   // the helper's window must appear
const START_TIMEOUT_MS = 1500;    // after the touch, the drag must start
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
        this._onBegin();
        this._send({cmd: 'show', uris: this._uris});
        this._timer('window', WINDOW_TIMEOUT_MS, () => this._finish('the helper window did not appear'));
        // The window may be mapped already (it is a fresh map event that we wait for).
        this._timer('abandon', MAX_DRAG_MS, () => this._finish('the drag took too long'));
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
        if (this._phase === Phase.WINDOW)
            this._handoff();
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

    _handoff() {
        this._clearTimer('window');
        if (!this._buttonDown() || !this._placeWindow()) {
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
        this._later(Math.max(HANDOFF_DELAY_MS, TOUCH_SETTLE_MS - touchAge), () => {
            if (this._phase !== Phase.WINDOW)
                return;
            const spot = this._buttonDown() ? this._placeWindow() : null;
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
            this._later(40, () => {
                this._move(px + 6, py + 6);
                this._later(30, () => {
                    this._move(px + 12, py + 12);
                    this._follow();
                });
            });
        });
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
            if (this._phase === Phase.TOUCH) {
                // Let go before the drag even began: nothing to wait for.
                this._finish('the mouse was released before the drag started');
            } else {
                // The drop is in the compositor's hands; the helper reports the end.
                this._timer('end', END_TIMEOUT_MS, () => this._finish('the helper did not report the end'));
            }
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
