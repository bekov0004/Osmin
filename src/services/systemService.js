import GLib from 'gi://GLib';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const LEASE_RENEW_S = 5;

/**
 * What the computer is doing, as the System widget sees it: a mirror of the Osmin service's numbers
 * (service/system). While something shows them, watch() makes the service sample often.
 * Signals: 'changed', 'alert' ({kind, title, text}).
 */
export class SystemService extends Signals.EventEmitter {
    /** @param {ModuleClient} module */
    constructor(module) {
        super();
        this._module = module;
        this._watchers = 0;
        this._renewId = 0;
        module.connect('state-changed', () => this.emit('changed'));
        module.connect('event', (_m, name, payload) => {
            if (name === 'alert')
                this.emit('alert', payload);
        });
    }

    get state() {
        return this._module.state;
    }

    /** Something shows the numbers now (true) or no longer does (false). */
    watch(on) {
        this._watchers = Math.max(0, this._watchers + (on ? 1 : -1));
        if (this._watchers > 0 && !this._renewId) {
            this._send(true);
            this._renewId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, LEASE_RENEW_S, () => {
                this._send(true);
                return GLib.SOURCE_CONTINUE;
            });
        } else if (this._watchers === 0 && this._renewId) {
            GLib.source_remove(this._renewId);
            this._renewId = 0;
            this._send(false);
        }
    }

    _send(on) {
        this._module.call('watch', {on}).catch(() => {});
    }

    destroy() {
        if (this._renewId)
            GLib.source_remove(this._renewId);
        this._renewId = 0;
    }
}

/** 1536 -> "1.5 KB/s" */
export function formatRate(bytesPerSecond) {
    const kb = bytesPerSecond / 1024;
    if (kb < 1)
        return `${Math.round(bytesPerSecond)} B/s`;
    if (kb < 1024)
        return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB/s`;
    return `${(kb / 1024).toFixed(1)} MB/s`;
}

export function formatBytes(bytes) {
    const gb = bytes / 1024 ** 3;
    return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}
