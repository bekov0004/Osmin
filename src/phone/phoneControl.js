import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const HELPER_REMOTE = '/data/local/tmp/osmin-input.jar';
const READY_TIMEOUT_S = 5;
const MAX_QUEUE = 120;
const WAKE_CODE = 224;            // KEYCODE_WAKEUP: turns the screen on, and does nothing when it is on
const KEEP_AWAKE_S = 15;
const TAP_MAX_PX = 12;
const TAP_MAX_MS = 350;

/** Where the helper jar is: next to src/ in the extension's folder. */
export function helperPath() {
    return Gio.File.new_for_uri(new URL('../../phone-helper/osmin-input.jar', import.meta.url).href).get_path();
}

/** What `adb input text` needs: spaces as %s and the shell's special characters escaped. */
export function escapeInputText(text) {
    return text.replace(/[^A-Za-z0-9._,@:/+=-]/g, ch => (ch === ' ' ? '%s' : `\\${ch}`));
}

/**
 * Touches and keys for one phone. First choice: osmin-input.jar, a small helper that runs on the
 * phone and injects real touches (a finger that goes down, moves and goes up, in a few
 * milliseconds). If it cannot start there, the phone's own `input` commands do the work (one process
 * per action: slower, taps and swipes only). Coordinates are pixels of the phone's screen.
 */
export class PhoneControl {
    /** @param {{adb: string, serial: string, onMode?: (mode: 'helper'|'input') => void}} options */
    constructor({adb, serial, onMode = () => {}}) {
        this._adb = adb;
        this._serial = serial;
        this._onMode = onMode;
        this._mode = null;
        this._process = null;
        this._queue = [];
        this._writing = false;
        this._closed = false;
        this._down = null;
        this._awakeId = 0;
        this._start();
    }

    /** 'helper', 'input', or null while it starts. */
    get mode() {
        return this._mode;
    }

    down(x, y) {
        this._down = {x, y, t: GLib.get_monotonic_time(), moved: false};
        this._send(`d ${x} ${y}`, 'helper');
    }

    move(x, y) {
        if (this._down && Math.hypot(x - this._down.x, y - this._down.y) > TAP_MAX_PX)
            this._down.moved = true;
        this._send(`m ${x} ${y}`, 'helper', true);
    }

    up(x, y) {
        const down = this._down;
        this._down = null;
        if (this._mode === 'helper') {
            this._send(`u ${x} ${y}`);
        } else if (down) {
            // Without the helper a gesture is one command, made when the finger lifts.
            const ms = Math.round((GLib.get_monotonic_time() - down.t) / 1000);
            if (!down.moved && ms < TAP_MAX_MS)
                this._send(`input tap ${down.x} ${down.y}`);
            else if (!down.moved)
                this._send(`input swipe ${down.x} ${down.y} ${down.x} ${down.y} ${Math.max(ms, 600)}`);
            else
                this._send(`input swipe ${down.x} ${down.y} ${x} ${y} ${Math.min(Math.max(ms, 80), 1000)}`);
        }
    }

    /** A straight swipe made in one go (the wheel). */
    swipe(x1, y1, x2, y2, ms = 220) {
        if (this._mode === 'helper') {
            const steps = 8;
            this._send(`d ${x1} ${y1}`);
            for (let i = 1; i <= steps; i++)
                this._send(`m ${Math.round(x1 + (x2 - x1) * i / steps)} ${Math.round(y1 + (y2 - y1) * i / steps)}`);
            this._send(`u ${x2} ${y2}`);
        } else {
            this._send(`input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`);
        }
    }

    key(code) {
        this._send(this._mode === 'helper' ? `k ${code}` : `input keyevent ${code}`);
    }

    /** Types ASCII text. */
    text(text) {
        this._send(this._mode === 'helper' ? `t ${text}` : `input text ${escapeInputText(text)}`);
    }

    /** A shell command on the phone (statusbar and so on). */
    shell(command) {
        if (this._mode === 'input') {
            this._queue.push({line: command, mode: 'input', any: false});
            this._flush();
        } else {
            this._shellOnce(command);
        }
    }

    /**
     * Wakes the phone, swipes the lock screen up and types the PIN or password. Nothing is kept: the code
     * goes to the phone once and is forgotten. (A pattern is drawn with the mouse instead.)
     * @param {string} secret @param {{w: number, h: number}} screen
     */
    unlock(secret, screen) {
        if (this._closed || !screen)
            return;
        const later = (ms, fn) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            if (!this._closed)
                fn();
            return GLib.SOURCE_REMOVE;
        });
        this.key(WAKE_CODE);
        later(700, () => this.swipe(Math.round(screen.w / 2), Math.round(screen.h * 0.85), Math.round(screen.w / 2), Math.round(screen.h * 0.3), 250));
        if (secret) {
            later(1700, () => this.text(secret));
            later(2200, () => this.key(66));
        }
    }

    /** Wakes the phone's screen now and every few seconds, so it does not sleep while it is being used. */
    keepAwake() {
        if (this._awakeId || this._closed)
            return;
        this.key(WAKE_CODE);
        this._awakeId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, KEEP_AWAKE_S, () => {
            this.key(WAKE_CODE);
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        if (this._awakeId)
            GLib.source_remove(this._awakeId);
        this._awakeId = 0;
        this._closed = true;
        this._process?.force_exit();
        this._process = null;
        this._queue = [];
    }

    // --- start ---------------------------------------------------------------------------------------

    _start() {
        let push;
        try {
            push = Gio.Subprocess.new([this._adb, '-s', this._serial, 'push', helperPath(), HELPER_REMOTE],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            this._fallback();
            return;
        }
        push.wait_check_async(null, (_p, result) => {
            let ok = true;
            try {
                push.wait_check_finish(result);
            } catch (e) {
                ok = false;
            }
            if (this._closed)
                return;
            if (ok)
                this._startHelper();
            else
                this._fallback();
        });
    }

    _startHelper() {
        let process;
        try {
            process = Gio.Subprocess.new([this._adb, '-s', this._serial, 'shell', `CLASSPATH=${HELPER_REMOTE}`, 'app_process', '/', 'dev.osmin.Input'],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            this._fallback();
            return;
        }
        const reader = new Gio.DataInputStream({base_stream: process.get_stdout_pipe()});
        let settled = false;
        const settle = ok => {
            if (settled || this._closed)
                return;
            settled = true;
            if (timer)
                GLib.source_remove(timer);
            if (ok) {
                this._process = process;
                this._setMode('helper');
                this._flush();
            } else {
                process.force_exit();
                this._fallback();
            }
        };
        let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, READY_TIMEOUT_S, () => {
            timer = 0;
            settle(false);
            return GLib.SOURCE_REMOVE;
        });
        reader.read_line_async(GLib.PRIORITY_DEFAULT, null, (_s, result) => {
            let line = '';
            try {
                [line] = reader.read_line_finish_utf8(result);
            } catch (e) {
                line = '';
            }
            settle(line?.trim() === 'READY');
        });
    }

    _fallback() {
        if (this._closed)
            return;
        try {
            this._process = Gio.Subprocess.new([this._adb, '-s', this._serial, 'shell'],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            console.warn(`[osmin] phone control: ${e.message}`);
            return;
        }
        this._setMode('input');
        this._flush();
    }

    _setMode(mode) {
        this._mode = mode;
        // Touch lines already waiting were made for the other mode: drop them.
        this._queue = this._queue.filter(item => item.any || item.mode === mode);
        this._onMode(mode);
    }

    // --- sending ---------------------------------------------------------------------------------------

    /** @param {string} line @param {string} [only] the mode this line belongs to (any if absent) @param {boolean} [droppable] */
    _send(line, only = null, droppable = false) {
        if (this._closed)
            return;
        if (only && this._mode && this._mode !== only)
            return;
        if (droppable && this._queue.length > MAX_QUEUE / 2)
            return;
        if (this._queue.length > MAX_QUEUE)
            this._queue.shift();
        const mode = this._mode ?? (line.startsWith('input ') ? 'input' : 'helper');
        this._queue.push({line, mode, any: false});
        this._flush();
    }

    _shellOnce(command) {
        try {
            Gio.Subprocess.new([this._adb, '-s', this._serial, 'shell', command],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            // ignore
        }
    }

    /** Writes the waiting lines one at a time, never blocking the caller. */
    _flush() {
        if (this._writing || !this._process || !this._mode)
            return;
        const item = this._queue.find(i => i.mode === this._mode);
        if (!item)
            return;
        this._queue.splice(this._queue.indexOf(item), 1);
        this._writing = true;
        const stdin = this._process.get_stdin_pipe();
        stdin.write_bytes_async(new GLib.Bytes(new TextEncoder().encode(`${item.line}\n`)), GLib.PRIORITY_DEFAULT, null, (_s, result) => {
            this._writing = false;
            try {
                stdin.write_bytes_finish(result);
            } catch (e) {
                return;
            }
            this._flush();
        });
    }
}
