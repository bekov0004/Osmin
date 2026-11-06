import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Module} from '../module.js';

const INHIBIT_IDLE = 8;     // GNOME session flags: do not let the session go idle ...
const INHIBIT_SUSPEND = 4;  // ... and do not suspend

/**
 * Keep awake: stops the screen from dimming, locking and the computer from suspending, for a
 * while or until it is turned off (like the Caffeine extension). The block is an "inhibitor" of
 * the GNOME session; it belongs to this process's D-Bus connection, so it ends with the service.
 * state: {until: ms epoch or 0, forever: bool}
 */
export class PowerModule extends Module {
    constructor() {
        super('Power');
        this._cookie = 0;
        this._until = 0;
        this._forever = false;
        this._timer = 0;
        this._allowDisplaySleep = false;
        this._lidFd = null;
    }

    get state() {
        return {until: this._until, forever: this._forever, lid: !!this._lidFd, allowDisplaySleep: this._allowDisplaySleep};
    }

    stop() {
        this._release();
        this._releaseLid();
    }

    /** Lets the display go to sleep while the computer is kept awake (or not). */
    async rpc_setDisplaySleep({allow}) {
        this._allowDisplaySleep = !!allow;
        if (this._cookie) {
            const until = this._until, forever = this._forever;
            const minutes = forever ? -1 : Math.max(1, Math.ceil((until - Date.now()) / 60000));
            await this.rpc_setAwake({minutes, allowDisplaySleep: this._allowDisplaySleep});
        }
        this.emitState();
    }

    /**
     * Keeps the computer running when the lid is closed: a systemd "handle-lid-switch" inhibitor,
     * which a user may take for the active session (no password).
     */
    async rpc_setLid({on}) {
        this._releaseLid();
        if (on) {
            await new Promise((resolve, reject) => {
                Gio.DBus.system.call_with_unix_fd_list('org.freedesktop.login1', '/org/freedesktop/login1', 'org.freedesktop.login1.Manager',
                    'Inhibit', new GLib.Variant('(ssss)', ['handle-lid-switch', 'Osmin', 'Keep going with the lid closed', 'block']),
                    null, Gio.DBusCallFlags.NONE, 5000, null, null, (connection, result) => {
                        try {
                            const [, fds] = connection.call_with_unix_fd_list_finish(result);
                            this._lidFd = fds.get(0);
                            resolve();
                        } catch (e) {
                            reject(new Error(`The lid cannot be kept open (${e.message})`));
                        }
                    });
            });
        }
        this.emitState();
    }

    _releaseLid() {
        if (this._lidFd !== null) {
            try {
                GLib.close(this._lidFd);
            } catch (e) {
                // already closed
            }
            this._lidFd = null;
        }
    }

    /** @param {{minutes: number}} args minutes: 0 turns it off, -1 keeps awake until turned off */
    async rpc_setAwake({minutes, allowDisplaySleep = this._allowDisplaySleep}) {
        this._release();
        this._allowDisplaySleep = !!allowDisplaySleep;
        if (minutes !== 0) {
            await this._inhibit();
            if (minutes > 0) {
                this._until = Date.now() + minutes * 60 * 1000;
                this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, minutes * 60, () => {
                    this._timer = 0;
                    this._release();
                    this.emitState();
                    this.emitEvent('awakeEnded');
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this._forever = true;
            }
        }
        this.emitState();
    }

    _inhibit() {
        return new Promise((resolve, reject) => {
            Gio.DBus.session.call('org.gnome.SessionManager', '/org/gnome/SessionManager', 'org.gnome.SessionManager',
                'Inhibit', new GLib.Variant('(susu)', ['Osmin', 0, 'Keep awake', (this._allowDisplaySleep ? 0 : INHIBIT_IDLE) | INHIBIT_SUSPEND]),
                null, Gio.DBusCallFlags.NONE, 5000, null, (connection, result) => {
                    try {
                        [this._cookie] = connection.call_finish(result).deepUnpack();
                        resolve();
                    } catch (e) {
                        reject(new Error(`The session cannot be kept awake (${e.message})`));
                    }
                });
        });
    }

    _release() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        if (this._cookie) {
            Gio.DBus.session.call('org.gnome.SessionManager', '/org/gnome/SessionManager', 'org.gnome.SessionManager',
                'Uninhibit', new GLib.Variant('(u)', [this._cookie]), null, Gio.DBusCallFlags.NONE, 2000, null, null);
            this._cookie = 0;
        }
        this._until = 0;
        this._forever = false;
    }
}
