import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {applyLogical, currentState, Method, modeOf, sizeOf} from './displayConfig.js';

const MIN_SOFT = 20;      // a monitor dimmed by Osmin never goes darker than this (it must stay readable)

/**
 * The monitors, for the Displays page: the brightness of each one and where they stand.
 *  - Brightness: GNOME's own control where the monitor has one (the built-in screen, and external monitors GNOME drives
 *    through DDC/CI), else ddcutil when it is installed and the monitor answers it, else Osmin dims the picture.
 *  - Arrangement: through GNOME's display configuration, remembered as GNOME Settings does. Moving a monitor or choosing
 *    the main one is applied at once; Mirror and Only one ask GNOME's "Keep these display settings?" (it goes back by
 *    itself when nobody answers, so a monitor that stays black is not a trap).
 * One for the whole shell (services.displays).
 */
export class DisplayService {
    /** @param {{gsettings: Gio.Settings|null}} options */
    constructor({gsettings}) {
        this._gsettings = gsettings;
        this._state = null;
        this._listeners = new Set();
        this._ddc = new Map();         // "product|serial" -> ddcutil display number
        this._ddcValues = new Map();   // connector -> percent
        this._ddcBusy = new Map();     // number -> {running, next}
        this._dims = new Map();        // monitor index -> overlay actor
        this._quiet = false;
        this._cancellable = new Gio.Cancellable();
        this._confirmId = global.window_manager.connect('confirm-display-change', () => this._onConfirm());
        Main.layoutManager.connectObject('monitors-changed', () => this.refresh().catch(() => {}), this);
        Main.brightnessManager?.connectObject('changed', () => this._changed(), this);
        this._gsettings?.connectObject('changed::display-dim', () => this._syncDims(), this);
        this._stageId = global.stage.connect('child-added', () => this._raiseDims());
        this.refresh();
        this._probeDdc();
    }

    destroy() {
        this._cancellable.cancel();
        global.window_manager.disconnect(this._confirmId);
        global.stage.disconnect(this._stageId);
        Main.layoutManager.disconnectObject(this);
        Main.brightnessManager?.disconnectObject(this);
        this._gsettings?.disconnectObject(this);
        this._unblockGnome();
        for (const actor of this._dims.values())
            actor.destroy();
        this._dims.clear();
        this._listeners.clear();
    }

    /** @param {() => void} callback called when something about the monitors changed; @returns {() => void} to stop */
    watch(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    _changed() {
        for (const callback of this._listeners) {
            try {
                callback();
            } catch (e) {
                console.warn(`[osmin] displays: ${e.message}`);
            }
        }
    }

    get state() {
        return this._state;
    }

    async refresh() {
        try {
            this._state = await currentState();
        } catch (e) {
            console.warn(`[osmin] displays: ${e.message}`);
            this._state = null;
        }
        try {
            this._syncDims();
        } catch (e) {
            console.warn(`[osmin] displays: dimming: ${e.message}`);
        }
        this._changed();
    }

    // --- which monitor is which ----------------------------------------------------------------------------

    /** connector -> the index GNOME Shell gives the monitor (Main.layoutManager.monitors). */
    _indexByConnector() {
        const map = new Map();
        for (const logical of global.backend.get_monitor_manager().get_logical_monitors()) {
            for (const monitor of logical.get_monitors())
                map.set(monitor.get_connector(), logical.get_number());
        }
        return map;
    }

    /** A name a person recognises: "Built-in display", or the monitor's own; the same names told apart. */
    nameOf(connector) {
        const monitors = this._state?.monitors ?? [];
        const monitor = monitors.find(m => m.connector === connector);
        if (!monitor)
            return connector;
        if (monitor.builtin)
            return 'Built-in display';
        const twins = monitors.filter(m => !m.builtin && m.name === monitor.name);
        return twins.length > 1 ? `${monitor.name} (${connector})` : monitor.name;
    }

    // --- brightness -----------------------------------------------------------------------------------------

    /**
     * One entry for every monitor that is on.
     * @returns {{connector, name, builtin, kind: 'gnome'|'ddc'|'osmin', value: number, set: (percent: number) => void}[]}
     */
    brightness() {
        if (!this._state)
            return [];
        const indices = this._indexByConnector();
        const scales = new Map((Main.brightnessManager?.scales ?? []).map(scale => [scale.monitor.get_number(), scale]));
        const on = new Set(this._state.logical.flatMap(l => l.connectors));
        return this._state.monitors.filter(m => on.has(m.connector)).map(monitor => {
            const index = indices.get(monitor.connector);
            const base = {connector: monitor.connector, name: this.nameOf(monitor.connector), builtin: monitor.builtin, index};
            const scale = scales.get(index);
            if (scale) {
                return {...base, kind: 'gnome', value: Math.round(scale.value * 100), set: percent => {
                    scale.value = percent / 100;
                }};
            }
            const ddc = this._ddc.get(`${monitor.product}|${monitor.serial}`) ?? this._ddc.get(`${monitor.product}|`);
            if (ddc !== undefined) {
                return {...base, kind: 'ddc', value: this._ddcValues.get(monitor.connector) ?? 50, set: percent => {
                    this._ddcValues.set(monitor.connector, percent);
                    this._setDdc(ddc, percent);
                }};
            }
            return {...base, kind: 'osmin', value: this._dimOf(monitor.connector), set: percent => this._setDim(monitor.connector, percent), min: MIN_SOFT};
        });
    }

    _run(argv) {
        return new Promise(resolve => {
            try {
                const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
                proc.communicate_utf8_async(null, this._cancellable, (_p, result) => {
                    try {
                        resolve(proc.communicate_utf8_finish(result)[1] ?? '');
                    } catch (e) {
                        resolve('');
                    }
                });
            } catch (e) {
                resolve('');
            }
        });
    }

    /** External monitors ddcutil can reach (only asked once: it takes a few seconds). */
    async _probeDdc() {
        if (!GLib.find_program_in_path('ddcutil'))
            return;
        const out = await this._run(['ddcutil', 'detect', '--brief']);
        for (const block of out.split(/\n(?=Display )/)) {
            const number = block.match(/^Display (\d+)/)?.[1];
            const monitor = block.match(/Monitor:\s+([^:\n]*):([^:\n]*):([^\n]*)/);
            if (!number || !monitor)
                continue;
            const [, , product, serial] = monitor.map(s => s.trim());
            this._ddc.set(`${product}|${serial}`, Number(number));
            if (!this._ddc.has(`${product}|`))
                this._ddc.set(`${product}|`, Number(number));
            const value = (await this._run(['ddcutil', '--display', number, 'getvcp', '10', '--brief'])).match(/VCP 10 C (\d+) (\d+)/);
            const connector = this._state?.monitors.find(m => m.product === product)?.connector;
            if (value && connector)
                this._ddcValues.set(connector, Math.round(100 * Number(value[1]) / Math.max(1, Number(value[2]))));
        }
        this._changed();
    }

    /** ddcutil is slow: while it runs only the last value asked for waits. */
    async _setDdc(number, percent) {
        const slot = this._ddcBusy.get(number) ?? {running: false, next: null};
        this._ddcBusy.set(number, slot);
        slot.next = percent;
        if (slot.running)
            return;
        slot.running = true;
        while (slot.next !== null) {
            const value = slot.next;
            slot.next = null;
            await this._run(['ddcutil', '--display', String(number), '--noverify', 'setvcp', '10', String(value)]);
        }
        slot.running = false;
    }

    _savedDims() {
        try {
            return this._gsettings?.get_value('display-dim').deepUnpack() ?? {};
        } catch (e) {
            return {};
        }
    }

    _dimOf(connector) {
        return this._savedDims()[connector] ?? 100;
    }

    _setDim(connector, percent) {
        const dims = this._savedDims();
        percent = Math.max(MIN_SOFT, Math.min(100, Math.round(percent)));
        if (percent >= 100)
            delete dims[connector];
        else
            dims[connector] = percent;
        this._gsettings?.set_value('display-dim', new GLib.Variant('a{si}', dims));
        if (!this._gsettings)
            this._syncDims(dims);
    }

    /** A dark veil over each monitor Osmin dims (input goes through it). */
    _syncDims(dims = this._savedDims()) {
        const indices = this._indexByConnector();
        const wanted = new Map();
        for (const entry of this.brightness()) {
            if (entry.kind === 'osmin' && (dims[entry.connector] ?? 100) < 100 && indices.has(entry.connector))
                wanted.set(indices.get(entry.connector), dims[entry.connector]);
        }
        for (const [index, actor] of this._dims) {
            if (!wanted.has(index)) {
                actor.destroy();
                this._dims.delete(index);
            }
        }
        for (const [index, percent] of wanted) {
            const geometry = Main.layoutManager.monitors[index];
            if (!geometry)
                continue;
            let actor = this._dims.get(index);
            if (!actor) {
                actor = new St.Widget({reactive: false, style: 'background-color: black;'});
                global.stage.add_child(actor);
                this._dims.set(index, actor);
            }
            actor.set_position(geometry.x, geometry.y);
            actor.set_size(geometry.width, geometry.height);
            actor.opacity = Math.round(255 * (1 - percent / 100));
        }
        this._raiseDims();
    }

    _raiseDims() {
        for (const actor of this._dims.values())
            global.stage.set_child_above_sibling(actor, null);
    }

    // --- arrangement ---------------------------------------------------------------------------------------

    /** The monitors as rectangles on the desktop: {id, x, y, w, h, primary, connectors, names}. */
    rects() {
        const state = this._state;
        if (!state)
            return [];
        return state.logical.map(l => ({
            id: l.connectors.join('+'),
            x: l.x, y: l.y, ...sizeOf(state, l),
            primary: l.primary,
            connectors: l.connectors,
            names: l.connectors.map(c => this.nameOf(c)),
        }));
    }

    /** 'join' (every monitor its own part of the desktop), 'mirror', or 'only:<connector>'. */
    get mode() {
        const state = this._state;
        if (!state || state.monitors.length < 2)
            return 'join';
        if (state.logical.some(l => l.connectors.length > 1))
            return 'mirror';
        if (state.logical.length === 1)
            return `only:${state.logical[0].connectors[0]}`;
        return 'join';
    }

    get monitorCount() {
        return this._state?.monitors.length ?? 0;
    }

    /** Moves monitors to these rectangles (from arrange.js); applied at once. */
    async arrange(rects) {
        const state = this._state;
        const byId = new Map(rects.map(r => [r.id, r]));
        const logical = state.logical.map(l => {
            const r = byId.get(l.connectors.join('+'));
            return {...l, x: r?.x ?? l.x, y: r?.y ?? l.y};
        });
        await this._apply(logical, {quiet: true});
    }

    async setPrimary(id) {
        const logical = this._state.logical.map(l => ({...l, primary: l.connectors.join('+') === id}));
        await this._apply(logical, {quiet: true});
    }

    /** Every monitor on, each its own part of the desktop: the ones that are off go to the right. */
    async join() {
        const state = this._state;
        const logical = [];
        const modes = {};
        let right = 0;
        for (const l of state.logical) {
            const one = {...l, connectors: [l.connectors[0]]};
            logical.push(one);
            right = Math.max(right, l.x + sizeOf(state, one).w);
        }
        const used = new Set(logical.map(l => l.connectors[0]));
        for (const monitor of state.monitors) {
            if (used.has(monitor.connector))
                continue;
            const mode = monitor.modes.find(m => m.preferred) ?? modeOf(monitor);
            const scale = mode.scale || 1;
            logical.push({x: right, y: 0, scale, transform: 0, primary: false, connectors: [monitor.connector]});
            modes[monitor.connector] = mode.id;
            right += state.layoutMode === 1 ? Math.round(mode.width / scale) : mode.width;
        }
        if (!logical.some(l => l.primary))
            logical[0].primary = true;
        await this._apply(logical, {modes});
    }

    /** The same picture on every monitor, at the biggest size they all have. */
    async mirror() {
        const state = this._state;
        const sizes = state.monitors.map(m => new Set(m.modes.map(mode => `${mode.width}x${mode.height}`)));
        const common = [...sizes[0]].filter(size => sizes.every(s => s.has(size)))
            .map(size => size.split('x').map(Number))
            .sort((a, b) => b[0] * b[1] - a[0] * a[1]);
        if (!common.length)
            throw new Error('These monitors have no size in common');
        const [width, height] = common[0];
        const modes = {};
        let scales = null;
        for (const monitor of state.monitors) {
            const mode = monitor.modes.filter(m => m.width === width && m.height === height).sort((a, b) => b.refresh - a.refresh)[0];
            modes[monitor.connector] = mode.id;
            scales = scales ? scales.filter(s => mode.scales.some(t => Math.abs(t - s) < 0.01)) : [...mode.scales];
        }
        const primaryScale = state.logical.find(l => l.primary)?.scale ?? 1;
        const scale = scales.find(s => Math.abs(s - primaryScale) < 0.01) ?? 1;
        await this._apply([{x: 0, y: 0, scale, transform: 0, primary: true, connectors: state.monitors.map(m => m.connector)}], {modes});
    }

    /** Only this monitor on. */
    async only(connector) {
        const state = this._state;
        const monitor = state.monitors.find(m => m.connector === connector);
        const was = state.logical.find(l => l.connectors.includes(connector));
        const mode = was ? modeOf(monitor) : monitor.modes.find(m => m.preferred) ?? modeOf(monitor);
        await this._apply([{x: 0, y: 0, scale: was?.scale ?? (mode.scale || 1), transform: was?.transform ?? 0, primary: true, connectors: [connector]}],
            {modes: {[connector]: mode.id}});
    }

    /**
     * Applies and remembers. quiet: GNOME's "Keep these display settings?" is answered here (the monitors only moved:
     * nothing can go black); otherwise GNOME asks, and goes back by itself if nobody answers.
     */
    async _apply(logical, {quiet = false, modes = {}} = {}) {
        if (quiet)
            this._blockGnome();
        try {
            await applyLogical(this._state, logical, {method: Method.PERSISTENT, modes});
        } catch (e) {
            this._unblockGnome();
            throw e;
        }
        // GNOME asks right away; should it not, nothing stays blocked
        if (quiet) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                this._unblockGnome();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _blockGnome() {
        if (this._blocked)
            return;
        const id = GObject.signal_handler_find(global.window_manager, {signalId: 'confirm-display-change'});
        if (id && id !== this._confirmId) {
            GObject.signal_handler_block(global.window_manager, id);
            this._blocked = id;
            this._quiet = true;
        }
    }

    _unblockGnome() {
        if (this._blocked)
            GObject.signal_handler_unblock(global.window_manager, this._blocked);
        this._blocked = 0;
        this._quiet = false;
    }

    _onConfirm() {
        if (!this._quiet)
            return;
        global.window_manager.complete_display_change(true);
        this._unblockGnome();
    }
}
