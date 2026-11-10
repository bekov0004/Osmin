import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const HELPER_REMOTE = '/data/local/tmp/osmin-input.jar';
const READY_TIMEOUT_S = 5;
const MAX_QUEUE = 120;
const WAKE_CODE = 224;            // KEYCODE_WAKEUP (only used without the helper)
const SLEEP_CODE = 223;           // KEYCODE_SLEEP: when the session ends in the dark, the phone goes to sleep by itself
const EXIT_WAIT_S = 2;            // the helper gets this long to say its last lines before it is stopped
const POWER_REPLY_S = 3;
const TAP_MAX_PX = 12;
const TAP_MAX_MS = 350;

/** Where the helper jar is: next to src/ in the extension's folder. */
export function helperPath() {
    // import.meta.url is .../src/phone/phoneControl.js (there is no URL class to resolve against).
    const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent();
    return root.get_child('phone-helper').get_child('osmin-input.jar').get_path();
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
    /**
     * @param {{adb: string, serial: string, dark?: boolean, onMode?: (mode: 'helper'|'input') => void,
     *   onDark?: (state: {dark: boolean, via: string|null}) => void}} options
     *   dark: keep the phone's screen dark while it is used from here;
     *   link: the control connection of the Osmin Phone app's server (see phoneLink.js), when there is one: then
     *   nothing is started with adb here
     */
    constructor({adb, serial, dark = false, link = null, onMode = () => {}, onDark = () => {}}) {
        this._adb = adb;
        this._serial = serial;
        this._onMode = onMode;
        this._onDark = onDark;
        this._wantDark = dark;
        this._darkVia = null;        // 'display' (panel off, phone awake) or 'brightness' (lowest light) while it is dark
        this._powerFailed = false;
        this._powerTimer = 0;
        this.darkError = '';
        this._mode = null;
        this._process = null;
        this._queue = [];
        this._writing = false;
        this._closed = false;
        this._down = null;
        if (link)
            this._useLink(link);
        else
            this._start();
    }

    /** 'helper', 'input', or null while it starts. */
    get mode() {
        return this._mode;
    }

    /** Whether it was asked to keep the screen dark. */
    get wantDark() {
        return this._wantDark;
    }

    /** Whether the phone's screen is being kept dark now: null, 'display' or 'brightness'. */
    get darkVia() {
        return this._darkVia;
    }

    /** Keeps the phone's screen dark (true) or lights it again (false) while the phone stays awake. */
    setDark(on) {
        this._wantDark = on;
        this._applyDark();
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
        // 1. Wake the phone if it sleeps (nothing when it is awake).
        this.wake();
        // 2. Ask the system to show the PIN pad (this works on a locked screen without a swipe) ...
        later(800, () => this.shell('wm dismiss-keyguard'));
        // 3. ... and swipe the lock screen up as well, for phones whose lock screen needs it.
        later(1500, () => this.swipe(Math.round(screen.w / 2), Math.round(screen.h * 0.85), Math.round(screen.w / 2), Math.round(screen.h * 0.3), 250));
        if (secret) {
            // 4. Type the code once the pad is up, then Enter (a pad that submits by itself ignores it).
            later(2600, () => this.text(secret));
            later(3100, () => this.key(66));
        }
    }

    /**
     * Keeps the phone from going to sleep while it is used here, without lighting anything: the helper
     * tells the system the user is active every few seconds. (Without the helper this does nothing: the
     * phone sleeps by its own timeout, and the Wake button wakes it.)
     */
    keepAwake() {
        if (this._closed || this._mode === 'input')
            return;
        this._send('w 1');
    }

    /**
     * Wakes the phone, but only if it is asleep, and never lights the panel more than a moment while it does
     * when the dark screen is on. Used by the Wake button and by the unlock.
     */
    wake() {
        if (this._closed)
            return;
        this._send(this._mode === 'input' ? `input keyevent ${WAKE_CODE}` : 'z');
    }

    destroy() {
        if (this._powerTimer)
            GLib.source_remove(this._powerTimer);
        this._powerTimer = 0;
        const process = this._process;
        this._closed = true;
        this._process = null;
        this._queue = [];
        if (!process)
            return;
        // A session that ends while the screen is dark ends dark: the phone is put to sleep, so nothing lights up
        // when the panel closes. (A session in the light leaves the phone as it is.)
        const stdin = process.get_stdin_pipe();
        try {
            if (this._darkVia === 'display')
                stdin.write_all(`k ${SLEEP_CODE}\np 3\n`, null);
            stdin.close(null);
        } catch (e) {
            // the phone is gone
        }
        // The helper ends by itself when its input ends; this is only for one that is stuck.
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, EXIT_WAIT_S, () => {
            process.force_exit();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** The Osmin Phone app's server is already connected: its lines are the helper's lines. */
    _useLink(connection) {
        this._process = {
            get_stdin_pipe: () => connection.get_output_stream(),
            get_stdout_pipe: () => connection.get_input_stream(),
            force_exit: () => {
                try {
                    connection.close(null);
                } catch (e) {
                    // already closed
                }
            },
        };
        this._setMode('helper');
        this._readHelper(new Gio.DataInputStream({base_stream: connection.get_input_stream()}));
        this._applyDark();
        this._flush();
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
                this._readHelper(reader);
                this._applyDark();
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
        this._applyDark();
    }

    // --- the dark screen ------------------------------------------------------------------------------

    /** What the helper says after READY: the answers to "p". */
    _readHelper(reader) {
        reader.read_line_async(GLib.PRIORITY_DEFAULT, null, (_s, result) => {
            let line = null;
            try {
                [line] = reader.read_line_finish_utf8(result);
            } catch (e) {
                line = null;
            }
            if (line === null || this._closed)
                return;
            if (this._powerTimer) {
                GLib.source_remove(this._powerTimer);
                this._powerTimer = 0;
            }
            if (line.startsWith('POWER OK')) {
                this._darkVia = line.trim().endsWith(' 0') ? 'display' : null;
                this.darkError = '';
                this._onDark({dark: this._darkVia !== null, via: this._darkVia});
            } else if (line.startsWith('POWER ERR')) {
                this._powerFailed = true;
                console.warn(`[osmin] phone: ${line}`);
                this._applyDark();
            }
            this._readHelper(reader);
        });
    }

    _applyDark() {
        if (this._closed || !this._mode)
            return;
        if (this._wantDark) {
            if (this._mode === 'helper' && !this._powerFailed) {
                this._send('p 0');
                if (!this._powerTimer) {
                    // No answer: the helper cannot do it on this phone.
                    this._powerTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POWER_REPLY_S, () => {
                        this._powerTimer = 0;
                        this._powerFailed = true;
                        this._applyDark();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            } else {
                // The phone does not let the panel be switched off: say so, change nothing else.
                this._wantDark = false;
                this.darkError = this._mode === 'helper' ? 'This phone does not allow turning its screen off from here' : 'Turning the screen off needs the Osmin helper on the phone, which could not start';
                this._onDark({dark: false, via: null, error: this.darkError});
            }
        } else {
            this._giveBackLight();
        }
    }

    /** Lights the screen again. */
    _giveBackLight() {
        if (this._darkVia === 'display') {
            // Written at once: the control may be destroyed right after this.
            try {
                this._process?.get_stdin_pipe()?.write_all('p 2\n', null);
            } catch (e) {
                // the phone is gone: nothing to give back
            }
        }
        if (this._darkVia !== null) {
            this._darkVia = null;
            if (!this._closed)
                this._onDark({dark: false, via: null});
        }
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
