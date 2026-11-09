import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Module} from '../module.js';

const LEASE_MS = 15000;          // the page asks again every few seconds while it is shown
const POLL_S = 2;
const PAIRING_TIMEOUT_MS = 3 * 60 * 1000;
const ADB_PATHS = ['/opt/android-sdk/platform-tools/adb', '/usr/lib/android-sdk/platform-tools/adb'];

const randomText = (alphabet, length) => Array.from({length}, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');

/** What `adb mdns services` prints -> [{name, type: 'pairing'|'connect', address}] */
export function parseMdns(text) {
    const found = [];
    for (const line of text.split('\n')) {
        const match = line.trim().match(/^(\S+)\s+_adb-tls-(pairing|connect)\._tcp\.?\s+(\S+:\d+)$/);
        if (match)
            found.push({name: match[1], type: match[2], address: match[3]});
    }
    return found;
}

/** What `adb devices -l` prints -> [{serial, state, model}] */
export function parseDevices(text) {
    const devices = [];
    for (const line of text.split('\n').slice(1)) {
        const match = line.trim().match(/^(\S+)\s+(device|offline|unauthorized|connecting)\b(.*)$/);
        if (!match)
            continue;
        const model = /model:(\S+)/.exec(match[3])?.[1]?.replace(/_/g, ' ') ?? '';
        devices.push({serial: match[1], state: match[2], model});
    }
    return devices;
}

/**
 * Phone: see and control an Android phone from the computer. The phone is paired with a QR code
 * (Developer options > Wireless debugging > Pair device with QR code), found by adb over mDNS and
 * connected; viewer.js then shows its screen in a window and sends the mouse and keyboard to it.
 * state: {adb, devices: [{serial, state, model}], mirroring: serial|null,
 *         pairing: null | {text, status: 'waiting'|'pairing'|'connecting'|'failed', message}}
 */
export class PhoneModule extends Module {
    constructor() {
        super('Phone');
        this._adb = GLib.getenv('OSMIN_ADB') || GLib.find_program_in_path('adb') || ADB_PATHS.find(p => GLib.file_test(p, GLib.FileTest.IS_EXECUTABLE)) || null;
        this._devices = [];
        this._pairing = null;
        this._pairingInfo = null;      // {name, password}
        this._viewer = null;           // {serial, window}
        this._until = 0;
        this._timer = 0;
        this._busy = false;
    }

    get state() {
        return {
            adb: !!this._adb,
            adbPath: this._adb,
            devices: this._devices,
            mirroring: this._viewer?.serial ?? null,
            pairing: this._pairing,
        };
    }

    start() {
        if (this._adb)
            this._run(['start-server']).catch(() => {});
    }

    stop() {
        this._stopTimer();
        this._viewer?.window.close();
        this._viewer = null;
    }

    /** The page is shown: keep looking at the phones (the lease ends by itself). */
    rpc_watch({on}) {
        this._until = on ? Date.now() + LEASE_MS : 0;
        if (on) {
            this._startTimer();
            this._tick();
        }
        return {};
    }

    /** Makes a QR code for the phone to scan and waits for it. */
    async rpc_startPairing() {
        if (!this._adb)
            throw new Error('adb is not installed');
        const name = `osmin-${randomText('abcdefghjkmnpqrstuvwxyz23456789', 5)}`;
        const password = randomText('0123456789', 6);
        this._pairingInfo = {name, password, since: Date.now(), tried: new Set()};
        this._pairing = {text: `WIFI:T:ADB;S:${name};P:${password};;`, status: 'waiting', message: ''};
        this._until = Math.max(this._until, Date.now() + LEASE_MS);
        this._startTimer();
        this.emitState();
        this._tick();
        return {};
    }

    rpc_cancelPairing() {
        this._pairing = null;
        this._pairingInfo = null;
        this.emitState();
        return {};
    }

    /** Opens the phone's screen in a window of its own, where it can be controlled. */
    async rpc_mirror({serial}) {
        if (!this._adb)
            throw new Error('adb is not installed');
        if (this._viewer?.serial === serial) {
            this._viewer.window.present();
            return {};
        }
        this._viewer?.window.close();
        const {PhoneViewer} = await import('./viewer.js');
        const device = this._devices.find(d => d.serial === serial);
        const entry = {serial, window: null};
        entry.window = new PhoneViewer({
            adb: this._adb, serial, title: device?.model || 'Phone',
            onClose: () => {
                if (this._viewer === entry)
                    this._viewer = null;
                this.emitState();
            },
            // The window's own button: close it and ask the capsule to show the phone again.
            onDock: () => {
                entry.window.close();
                this.emitEvent('dock');
            },
        });
        this._viewer = entry;
        entry.window.present();
        this.emitState();
        return {};
    }

    rpc_stopMirror() {
        this._viewer?.window.close();
        return {};
    }

    async rpc_disconnect({serial}) {
        if (this._viewer?.serial === serial)
            this._viewer.window.close();
        await this._run(['disconnect', serial]);
        await this._refreshDevices();
        return {};
    }

    // --- the loop --------------------------------------------------------------------------------

    _startTimer() {
        if (this._timer)
            return;
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_S, () => {
            if (Date.now() > this._until) {
                this._timer = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTimer() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
    }

    async _tick() {
        if (this._busy || !this._adb)
            return;
        this._busy = true;
        try {
            await this._refreshDevices();
            if (this._pairing && ['waiting', 'connecting'].includes(this._pairing.status))
                await this._advancePairing();
        } catch (e) {
            console.warn(`[osmin-service] Phone: ${e.message}`);
        } finally {
            this._busy = false;
        }
    }

    async _refreshDevices() {
        const {out} = await this._run(['devices', '-l']);
        const devices = parseDevices(out);
        if (JSON.stringify(devices) !== JSON.stringify(this._devices)) {
            this._devices = devices;
            this.emitState();
        }
    }

    /** waiting: the phone showed up for pairing -> pair; connecting: the phone offers a connection -> connect. */
    async _advancePairing() {
        const info = this._pairingInfo;
        if (!info || Date.now() - info.since > PAIRING_TIMEOUT_MS) {
            this._setPairing('failed', 'Time is up. Try again.');
            return;
        }
        const {out} = await this._run(['mdns', 'services']);
        const services = parseMdns(out);
        if (this._pairing.status === 'waiting') {
            const entry = services.find(s => s.type === 'pairing' && s.name === info.name);
            if (!entry || info.tried.has(entry.address))
                return;
            info.tried.add(entry.address);
            info.host = entry.address.split(':')[0];
            this._setPairing('pairing', 'Pairing…');
            const result = await this._run(['pair', entry.address, info.password]);
            if (result.status !== 0 || !/Successfully paired/i.test(result.out)) {
                this._setPairing('failed', (result.out || result.err).trim().split('\n')[0] || 'Pairing failed');
                return;
            }
            this._setPairing('connecting', 'Paired. Connecting…');
        }
        if (this._pairing.status === 'connecting') {
            const entry = services.find(s => s.type === 'connect' && s.address.startsWith(`${info.host}:`));
            if (!entry)
                return;
            const result = await this._run(['connect', entry.address]);
            if (!/connected to/i.test(result.out)) {
                this._setPairing('failed', result.out.trim().split('\n')[0] || 'Could not connect');
                return;
            }
            this._pairing = null;
            this._pairingInfo = null;
            await this._refreshDevices();
            this.emitEvent('connected', {serial: entry.address});
            this.emitState();
        }
    }

    _setPairing(status, message) {
        if (this._pairing) {
            this._pairing = {...this._pairing, status, message};
            this.emitState();
        }
    }

    /** Runs adb. @returns {Promise<{status: number, out: string, err: string}>} */
    _run(args) {
        return new Promise((resolve, reject) => {
            let process;
            try {
                process = Gio.Subprocess.new([this._adb, ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            } catch (e) {
                reject(e);
                return;
            }
            let kill = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
                kill = 0;
                process.force_exit();
                return GLib.SOURCE_REMOVE;
            });
            process.communicate_utf8_async(null, null, (_p, result) => {
                if (kill)
                    GLib.source_remove(kill);
                try {
                    const [, out, err] = process.communicate_utf8_finish(result);
                    resolve({status: process.get_exit_status(), out: out ?? '', err: err ?? ''});
                } catch (e) {
                    reject(e);
                }
            });
        });
    }
}
