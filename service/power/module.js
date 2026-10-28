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
    }

    get state() {
        return {until: this._until, forever: this._forever};
    }

    stop() {
        this._release();
    }

    /** @param {{minutes: number}} args minutes: 0 turns it off, -1 keeps awake until turned off */
    async rpc_setAwake({minutes}) {
        this._release();
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
                'Inhibit', new GLib.Variant('(susu)', ['Osmin', 0, 'Keep awake', INHIBIT_IDLE | INHIBIT_SUSPEND]),
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
