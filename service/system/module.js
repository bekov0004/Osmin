import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Module} from '../module.js';

const HISTORY = 60;             // samples kept for the graphs
const WATCHED_MS = 2000;        // sampling while a widget shows the numbers
const IDLE_MS = 10000;          // sampling otherwise (for the alerts)
const WATCH_LEASE_S = 15;       // a watcher must renew its lease; a lost client does not keep us busy
const CPU_ALERT = 90;           // % for CPU_ALERT_SAMPLES samples in a row
const CPU_ALERT_SECONDS = 30;
const TEMP_ALERT = 85;          // °C
const MEM_ALERT = 8;            // % of memory still available
const DISK_ALERT = 5;           // % of the disk still free
const BATTERY_ALERT = 20;       // %

const readText = path => {
    try {
        return new TextDecoder().decode(GLib.file_get_contents(path)[1]).trim();
    } catch (e) {
        return null;
    }
};
const readNumber = path => {
    const text = readText(path);
    return text === null || text === '' ? null : Number(text);
};
const listDir = path => {
    try {
        const names = [];
        const enumerator = Gio.File.new_for_path(path).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null))
            names.push(info.get_name());
        return names.sort();
    } catch (e) {
        return [];
    }
};

/**
 * What the computer is doing: processor, memory, temperature, network, disk and batteries (also of
 * keyboards, mice and the like), read from /proc and /sys. It also watches for trouble and says so
 * once per problem (the extension shows a card): a processor busy for half a minute, a hot
 * processor, memory or disk nearly full, a low battery. Nothing is stored or sent anywhere.
 *
 * state: {cpu, mem: {percent, total, used}, swap, temp, net: {rx, tx}, disk: {percent, free, total},
 *         battery: {percent, charging}|null, devices: [{name, percent}], history: {cpu, mem, rx, tx}}
 * events: alert {kind, title, text}
 */
export class SystemModule extends Module {
    constructor() {
        super('System');
        this._watchers = 0;
        this._leaseId = 0;
        this._sampleId = 0;
        this._previousCpu = null;
        this._previousNet = null;
        this._history = {cpu: [], mem: [], rx: [], tx: []};
        this._sample = null;
        this._active = new Set();   // alerts that are on now (said once)
        this._busy = 0;             // consecutive busy samples
    }

    get state() {
        return {...(this._sample ?? {}), history: this._history, watched: this._watchers > 0};
    }

    start() {
        this._take();
        this._schedule();
    }

    stop() {
        if (this._sampleId)
            GLib.source_remove(this._sampleId);
        if (this._leaseId)
            GLib.source_remove(this._leaseId);
        this._sampleId = this._leaseId = 0;
    }

    /** A widget shows the numbers: sample often. It renews the lease every few seconds. */
    async rpc_watch({on = true}) {
        if (on) {
            this._watchers = 1;
            if (this._leaseId)
                GLib.source_remove(this._leaseId);
            this._leaseId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, WATCH_LEASE_S, () => {
                this._leaseId = 0;
                this._watchers = 0;
                this._schedule();
                return GLib.SOURCE_REMOVE;
            });
            this._take();
        } else {
            this._watchers = 0;
            if (this._leaseId) {
                GLib.source_remove(this._leaseId);
                this._leaseId = 0;
            }
        }
        this._schedule();
    }

    _schedule() {
        if (this._sampleId)
            GLib.source_remove(this._sampleId);
        this._sampleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._watchers > 0 ? WATCHED_MS : IDLE_MS, () => {
            this._take();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _take() {
        const sample = this._read();
        this._sample = sample;
        const push = (list, value) => {
            list.push(value);
            if (list.length > HISTORY)
                list.shift();
        };
        push(this._history.cpu, sample.cpu);
        push(this._history.mem, sample.mem.percent);
        push(this._history.rx, sample.net.rx);
        push(this._history.tx, sample.net.tx);
        this._evaluate(sample);
        if (this._watchers > 0)
            this.emitState();
    }

    _read() {
        return {
            cpu: this._readCpu(),
            mem: this._readMemory(),
            swap: this._readSwap(),
            temp: this._readTemperature(),
            net: this._readNetwork(),
            disk: this._readDisk(),
            battery: this._readBattery(),
            devices: this._readDevices(),
        };
    }

    _readCpu() {
        const line = (readText('/proc/stat') ?? '').split('\n')[0].split(/\s+/).slice(1).map(Number);
        if (line.length < 5)
            return 0;
        const idle = line[3] + (line[4] ?? 0);
        const total = line.reduce((a, b) => a + b, 0);
        const previous = this._previousCpu;
        this._previousCpu = {idle, total};
        if (!previous || total === previous.total)
            return 0;
        return Math.round(100 * (1 - (idle - previous.idle) / (total - previous.total)));
    }

    _readMemory() {
        const text = readText('/proc/meminfo') ?? '';
        const value = key => Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? 0) * 1024;
        const total = value('MemTotal');
        const available = value('MemAvailable');
        return {total, used: total - available, percent: total > 0 ? Math.round(100 * (total - available) / total) : 0};
    }

    _readSwap() {
        const text = readText('/proc/meminfo') ?? '';
        const total = Number(text.match(/^SwapTotal:\s+(\d+)/m)?.[1] ?? 0);
        const free = Number(text.match(/^SwapFree:\s+(\d+)/m)?.[1] ?? 0);
        return total > 0 ? Math.round(100 * (total - free) / total) : 0;
    }

    /** The hottest processor sensor (°C), or null. */
    _readTemperature() {
        let best = null;
        for (const dir of listDir('/sys/class/hwmon')) {
            const base = `/sys/class/hwmon/${dir}`;
            const name = readText(`${base}/name`) ?? '';
            if (!/coretemp|k10temp|zenpower|cpu|acpitz|thermal|soc/i.test(name))
                continue;
            for (const file of listDir(base).filter(f => /^temp\d+_input$/.test(f))) {
                const milli = readNumber(`${base}/${file}`);
                if (milli !== null && milli > 0 && milli < 150000)
                    best = Math.max(best ?? 0, milli / 1000);
            }
        }
        return best === null ? null : Math.round(best);
    }

    /** Bytes per second in and out, over all real interfaces. */
    _readNetwork() {
        const now = GLib.get_monotonic_time() / 1e6;
        let rx = 0, tx = 0;
        for (const line of (readText('/proc/net/dev') ?? '').split('\n').slice(2)) {
            const [name, rest] = line.split(':');
            if (!rest || /^\s*(lo|docker|br-|veth|virbr)/.test(name))
                continue;
            const fields = rest.trim().split(/\s+/).map(Number);
            rx += fields[0] ?? 0;
            tx += fields[8] ?? 0;
        }
        const previous = this._previousNet;
        this._previousNet = {rx, tx, at: now};
        if (!previous || now <= previous.at)
            return {rx: 0, tx: 0};
        return {rx: Math.max(0, (rx - previous.rx) / (now - previous.at)), tx: Math.max(0, (tx - previous.tx) / (now - previous.at))};
    }

    _readDisk() {
        try {
            const info = Gio.File.new_for_path(GLib.get_home_dir()).query_filesystem_info('filesystem::size,filesystem::free', null);
            const total = info.get_attribute_uint64('filesystem::size');
            const free = info.get_attribute_uint64('filesystem::free');
            return {total, free, percent: total > 0 ? Math.round(100 * (total - free) / total) : 0};
        } catch (e) {
            return {total: 0, free: 0, percent: 0};
        }
    }

    _readBattery() {
        for (const name of listDir('/sys/class/power_supply')) {
            const base = `/sys/class/power_supply/${name}`;
            if (readText(`${base}/type`) !== 'Battery' || readText(`${base}/scope`) === 'Device')
                continue;
            const percent = readNumber(`${base}/capacity`);
            if (percent === null)
                continue;
            const status = readText(`${base}/status`) ?? '';
            return {percent, charging: status === 'Charging' || status === 'Full', status};
        }
        return null;
    }

    /** Batteries of keyboards, mice, headsets, phones ... */
    _readDevices() {
        const devices = [];
        for (const name of listDir('/sys/class/power_supply')) {
            const base = `/sys/class/power_supply/${name}`;
            if (readText(`${base}/scope`) !== 'Device')
                continue;
            const percent = readNumber(`${base}/capacity`);
            if (percent !== null)
                devices.push({name: readText(`${base}/model_name`) || name, percent});
        }
        return devices;
    }

    /** Says each problem once, and again only after it went away. */
    _evaluate(sample) {
        const check = (kind, on, title, text) => {
            if (on && !this._active.has(kind)) {
                this._active.add(kind);
                this.emitEvent('alert', {kind, title, text});
            } else if (!on) {
                this._active.delete(kind);
            }
        };
        this._busy = sample.cpu >= CPU_ALERT ? this._busy + 1 : 0;
        const busySeconds = this._busy * (this._watchers > 0 ? WATCHED_MS : IDLE_MS) / 1000;
        check('cpu', busySeconds >= CPU_ALERT_SECONDS, 'The processor is busy', `${sample.cpu}% for ${Math.round(busySeconds)} seconds`);
        check('temp', sample.temp !== null && sample.temp >= TEMP_ALERT, 'The computer is hot', `${sample.temp}°C`);
        check('mem', sample.mem.total > 0 && 100 - sample.mem.percent <= MEM_ALERT, 'Memory is nearly full', `${sample.mem.percent}% in use`);
        check('disk', sample.disk.total > 0 && 100 - sample.disk.percent <= DISK_ALERT, 'The disk is nearly full', `${100 - sample.disk.percent}% free`);
        check('battery', sample.battery !== null && !sample.battery.charging && sample.battery.percent <= BATTERY_ALERT,
            'Battery is low', `${sample.battery?.percent}%`);
        for (const device of sample.devices)
            check(`device:${device.name}`, device.percent <= BATTERY_ALERT, `${device.name}: battery is low`, `${device.percent}%`);
    }
}
