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
        this._config = null;
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

    /** How often to read and the limits of the alerts (0 is off): {interval, limits}. */
    configure(config) {
        this._config = config;
        this._module.call('configure', config).catch(() => {});
    }

    _send(on) {
        if (on && this._config)
            this._module.call('configure', this._config).catch(() => {});
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
    if (bytes < 1024)
        return `${Math.max(0, Math.round(bytes))} B`;
    if (bytes < 1024 ** 2)
        return `${Math.round(bytes / 1024)} KB`;
    if (bytes < 1024 ** 3)
        return `${(bytes / 1024 ** 2).toFixed(bytes < 100 * 1024 ** 2 ? 1 : 0)} MB`;
    const gb = bytes / 1024 ** 3;
    return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

/** 52 -> "52°C" or "126°F", by the user's choice. */
export function formatTemperature(celsius, unit = 'C') {
    if (celsius === null || celsius === undefined)
        return 'n/a';
    return unit === 'F' ? `${Math.round(celsius * 9 / 5 + 32)}°F` : `${Math.round(celsius)}°C`;
}

/** The short readings written in the top bar: [{id, label, value}] for the chosen ids. */
export function barReadings(state, ids) {
    const rate = v => formatRate(v).replace(' B/s', 'B').replace(' KB/s', 'K').replace(' MB/s', 'M');
    const all = {
        cpu: ['CPU', `${state.cpu}%`],
        cputemp: ['TMP', state.temp === null ? null : `${state.temp}°`],
        gpu: ['GPU', state.gpu?.busy == null ? null : `${state.gpu.busy}%`],
        mem: ['RAM', `${state.mem?.percent}%`],
        battery: ['BAT', state.battery ? `${state.battery.percent}%` : null],
        net: ['NET', `↓${rate(state.net.rx)} ↑${rate(state.net.tx)}`],
        disk: ['DSK', `${state.disk?.percent}%`],
        diskio: ['I/O', `R${rate(state.io.read)} W${rate(state.io.write)}`],
        power: ['PWR', state.power ? `${state.power.watts}W` : null],
    };
    return ids.filter(id => all[id] && all[id][1] !== null).map(id => ({id, label: all[id][0], value: all[id][1]}));
}
