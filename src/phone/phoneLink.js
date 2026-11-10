import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * The phone dials the computer. Osmin Phone (the Android app, android/) has a small server that runs on the
 * phone with adb's rights; it connects twice to a port the computer listens on:
 *   C  the control lines (touches, keys, the dark screen ...) and their replies
 *   V  the picture, a raw H.264 stream
 * Each connection starts with "HELLO <role> <token> <screen> <sdk> <model>" and gets "OK" back. The token is a
 * secret only this computer and the phone it started the server on know. Nothing is found by name, so it works in a
 * network the phone shares as well as in one the computer shares.
 */

export const APP_ID = 'dev.osmin.phone';
const SERVER_CLASS = 'dev.osmin.phone.server.Server';
const PRIORITY = GLib.PRIORITY_DEFAULT;

/** Every "inet 192.168.0.15/24" of the output of `ip -4 addr show`. */
export function addressesOf(text) {
    const found = [];
    for (const match of text.matchAll(/inet (\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)/g))
        found.push({ip: match.slice(1, 5).map(Number), prefix: Number(match[5])});
    return found;
}

const toNumber = ip => ((ip[0] * 256 + ip[1]) * 256 + ip[2]) * 256 + ip[3];
const dotted = ip => ip.join('.');

function sameSubnet(a, b) {
    const prefix = Math.min(a.prefix, b.prefix);
    if (prefix < 8 || a.ip[0] === 127 || b.ip[0] === 127)
        return false;
    const size = 2 ** (32 - prefix);
    return Math.floor(toNumber(a.ip) / size) === Math.floor(toNumber(b.ip) / size);
}

/**
 * The address of this computer that the phone can reach: the one in the same network as one of the phone's
 * addresses (the network the computer shares, or the one the phone shares). @returns {string|null}
 */
export function lanAddress(phoneText, localText) {
    const phone = addressesOf(phoneText);
    for (const local of addressesOf(localText)) {
        if (phone.some(p => sameSubnet(p, local)))
            return dotted(local.ip);
    }
    return null;
}

export function randomToken() {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < bytes.length; i++)
        bytes[i] = GLib.random_int_range(0, 256);
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Runs a command and gives its output. @returns {Promise<{status: number, out: string}>} */
export function run(argv) {
    return new Promise(resolve => {
        let process;
        try {
            process = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            resolve({status: -1, out: ''});
            return;
        }
        process.communicate_utf8_async(null, null, (_p, result) => {
            try {
                const [, out] = process.communicate_utf8_finish(result);
                resolve({status: process.get_exit_status(), out: out ?? ''});
            } catch (e) {
                resolve({status: -1, out: ''});
            }
        });
    });
}

/** Listens for the phone's two connections. */
export class PhoneLink {
    constructor() {
        this._service = null;
        this._pending = new Map();     // token -> {C, V, info, resolve, reject, timer}
        this.port = 0;
    }

    start() {
        if (this._service)
            return;
        this._service = new Gio.SocketService();
        this.port = this._service.add_any_inet_port(null);
        this._service.connect('incoming', (_service, connection) => {
            this._onIncoming(connection);
            return true;
        });
        this._service.start();
    }

    stop() {
        for (const [token, entry] of this._pending) {
            if (entry.timer)
                GLib.source_remove(entry.timer);
            entry.reject(new Error('stopped'));
            this._pending.delete(token);
        }
        this._service?.stop();
        this._service?.close();
        this._service = null;
    }

    /**
     * Waits for the phone that was given `token` to connect twice.
     * @returns {Promise<{control: Gio.SocketConnection, video: Gio.SocketConnection, info: string}>}
     */
    expect(token, timeoutS = 12) {
        return new Promise((resolve, reject) => {
            const entry = {C: null, V: null, info: '', resolve, reject, timer: 0};
            entry.timer = GLib.timeout_add_seconds(PRIORITY, timeoutS, () => {
                entry.timer = 0;
                this._pending.delete(token);
                entry.C?.close(null);
                entry.V?.close(null);
                reject(new Error('the phone did not connect'));
                return GLib.SOURCE_REMOVE;
            });
            this._pending.set(token, entry);
        });
    }

    _onIncoming(connection) {
        const input = new Gio.DataInputStream({base_stream: connection.get_input_stream()});
        // The phone sends nothing more until it has the answer, so a buffered read of the line takes nothing else.
        input.read_line_async(PRIORITY, null, (_stream, result) => {
            let line = null;
            try {
                [line] = input.read_line_finish_utf8(result);
            } catch (e) {
                line = null;
            }
            const parts = (line ?? '').trim().split(' ');
            const entry = parts[0] === 'HELLO' ? this._pending.get(parts[2]) : null;
            const role = parts[1];
            if (!entry || (role !== 'C' && role !== 'V') || entry[role]) {
                this._answer(connection, 'NO', true);
                return;
            }
            this._answer(connection, 'OK', false);
            entry[role] = connection;
            entry.info = parts.slice(3).join(' ');
            if (entry.C && entry.V) {
                if (entry.timer)
                    GLib.source_remove(entry.timer);
                this._pending.delete(parts[2]);
                entry.resolve({control: entry.C, video: entry.V, info: entry.info});
            }
        });
    }

    _answer(connection, text, close) {
        try {
            connection.get_output_stream().write_all(`${text}\n`, null);
            connection.get_output_stream().flush(null);
        } catch (e) {
            // the phone is gone
        }
        if (close)
            connection.close(null);
    }
}

/** Whether the Android app is installed on the phone: the path of its apk, or null. */
export async function appPath(adb, serial) {
    const {out} = await run([adb, '-s', serial, 'shell', 'pm', 'path', APP_ID]);
    const match = /package:(\S+\.apk)/.exec(out);
    return match ? match[1] : null;
}

/**
 * Starts the phone's server with adb (once; after that the computer and the phone talk to each other) and waits
 * for it to connect. @returns {Promise<{control, video, info, process: Gio.Subprocess}>}; rejects when it cannot.
 * @param {{adb: string, serial: string, link: PhoneLink, apk: string}} options
 */
export async function launchServer({adb, serial, link, apk}) {
    const phoneAddresses = await run([adb, '-s', serial, 'shell', 'ip', '-4', 'addr', 'show']);
    const localAddresses = await run(['ip', '-4', 'addr', 'show']);
    const host = lanAddress(phoneAddresses.out, localAddresses.out);
    if (!host)
        throw new Error('the phone and this computer are not in the same network');
    link.start();
    const token = randomToken();
    const waiting = link.expect(token);
    waiting.catch(() => {});
    let process;
    try {
        process = Gio.Subprocess.new([adb, '-s', serial, 'shell', `CLASSPATH=${apk}`, 'app_process', '/', SERVER_CLASS, host, String(link.port), token],
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
    } catch (e) {
        throw new Error(`could not start the phone's server: ${e.message}`);
    }
    try {
        const connections = await waiting;
        return {...connections, process};
    } catch (e) {
        process.force_exit();
        throw e;
    }
}
