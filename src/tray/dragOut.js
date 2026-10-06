import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const HELPER = GLib.build_filenamev([
    GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]), '..', 'helpers', 'dragout.js',
]);
const WINDOW_TITLE = 'OsminDragOut';
const WINDOW_SIZE = 140;

/**
 * Lets files be dragged out of the tray into other applications.
 *
 * A shell extension cannot start a Wayland drag itself, so a tiny helper
 * process (helpers/dragout.js) owns the drag: it is started when the mouse
 * goes down on a file, and once the pointer has moved far enough its window is
 * placed under the pointer and handed a fresh mouse press, which makes the
 * helper start a normal drag. The capsule hides meanwhile.
 */
export class DragOutService {
    /** @param {{onBegin: Function, onEnd: Function}} hooks */
    constructor({onBegin, onEnd}) {
        this._onBegin = onBegin;
        this._onEnd = onEnd;
        this._proc = null;
        this._window = null;
        this._mapId = 0;
        this._wantDrag = false;
        this._busy = false;
        this._timeouts = new Set();
        this._followId = 0;
    }

    get busy() {
        return this._busy;
    }

    /** The mouse went down on a file: warm the helper up. */
    prepare(uris) {
        this.cancel();
        try {
            this._proc = new Gio.Subprocess({
                argv: ['gjs', '-m', HELPER, ...uris],
                flags: Gio.SubprocessFlags.NONE,
            });
            this._proc.init(null);
        } catch (e) {
            console.warn(`[osmin] drag out unavailable: ${e.message}`);
            this._proc = null;
            return;
        }
        const proc = this._proc;
        proc.wait_async(null, () => {
            if (this._proc === proc)
                this._finish();
        });
        this._mapId = global.window_manager.connect('map', (_wm, actor) => {
            const win = actor.meta_window;
            if (win?.get_title() === WINDOW_TITLE) {
                this._window = win;
                if (this._wantDrag)
                    this._handoff();
            }
        });
    }

    /** The pointer moved far enough with the mouse down: start the real drag as soon as possible. */
    begin() {
        if (!this._proc || this._wantDrag)
            return;
        this._wantDrag = true;
        if (this._window)
            this._handoff();
    }

    /** The mouse went up before a drag started. */
    cancel() {
        if (this._busy)
            return;
        this._teardown();
    }

    destroy() {
        this._teardown();
    }

    _handoff() {
        if (this._busy)
            return;
        this._busy = true;
        this._onBegin();

        const win = this._window;
        const seat = global.stage.context.get_backend().get_default_seat();
        // A touch, not a button: the mouse button is already held down (the shell
        // saw that press), and the compositor ignores a second press. A virtual
        // finger that follows the pointer is a fresh press the helper can drag from.
        const touch = seat.create_virtual_device(Clutter.InputDeviceType.TOUCHSCREEN_DEVICE);
        const now = () => GLib.get_monotonic_time();
        const later = (ms, fn) => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._timeouts.delete(id);
                fn();
                return GLib.SOURCE_REMOVE;
            });
            this._timeouts.add(id);
        };
        // The pointer keeps moving while this happens: put the window under it again.
        const place = () => {
            const [px, py] = global.get_pointer();
            win.move_frame(true, Math.round(px - WINDOW_SIZE / 2), Math.round(py - WINDOW_SIZE / 2));
            return [px, py];
        };

        place();
        win.raise();
        later(100, () => {
            const [px, py] = place();
            touch.notify_touch_down(now(), 0, px, py);
            later(40, () => {
                touch.notify_touch_motion(now(), 0, px + 6, py + 6);
                later(30, () => {
                    touch.notify_touch_motion(now(), 0, px + 12, py + 12);
                    this._follow(touch);
                });
            });
        });
    }

    /** Moves the virtual finger with the pointer until the mouse button is let go. */
    _follow(touch) {
        const now = () => GLib.get_monotonic_time();
        this._followId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 8, () => {
            const [x, y, mods] = global.get_pointer();
            if (mods & Clutter.ModifierType.BUTTON1_MASK) {
                touch.notify_touch_motion(now(), 0, x, y);
                return GLib.SOURCE_CONTINUE;
            }
            touch.notify_touch_up(now(), 0);
            this._followId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _finish() {
        const wasBusy = this._busy;
        this._teardown();
        if (wasBusy)
            this._onEnd();
    }

    _teardown() {
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        if (this._followId) {
            GLib.source_remove(this._followId);
            this._followId = 0;
        }
        if (this._mapId) {
            global.window_manager.disconnect(this._mapId);
            this._mapId = 0;
        }
        const proc = this._proc;
        this._proc = null;
        this._window = null;
        this._wantDrag = false;
        this._busy = false;
        if (proc && !proc.get_if_exited())
            proc.force_exit();
    }
}
