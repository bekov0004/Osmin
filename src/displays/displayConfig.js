import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * GNOME's display configuration (org.gnome.Mutter.DisplayConfig, what GNOME Settings → Displays uses): which monitors
 * are connected, where each one is, which is the main one, and changing that.
 */

const BUS_NAME = 'org.gnome.Mutter.DisplayConfig';
const OBJECT_PATH = '/org/gnome/Mutter/DisplayConfig';
const INTERFACE = 'org.gnome.Mutter.DisplayConfig';

export const Method = {VERIFY: 0, TEMPORARY: 1, PERSISTENT: 2};

function call(method, parameters = null) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, INTERFACE, method, parameters, null, Gio.DBusCallFlags.NONE, 5000, null, (connection, result) => {
            try {
                resolve(connection.call_finish(result));
            } catch (e) {
                reject(e);
            }
        });
    });
}

const unpack = value => (value instanceof GLib.Variant ? value.recursiveUnpack() : value);

/**
 * Everything about the monitors now.
 * @returns {Promise<{serial: number, monitors: object[], logical: object[], layoutMode: number, canMirror: boolean}>}
 *   monitors: {connector, vendor, product, serial, name, builtin, modes: [{id, width, height, refresh, scale, scales, current, preferred}]}
 *   logical: {x, y, scale, transform, primary, connectors: string[]}
 */
export async function currentState() {
    const reply = await call('GetCurrentState');
    const [serial, monitors, logical, properties] = reply.deepUnpack();
    const props = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, unpack(v)]));
    return {
        serial,
        layoutMode: props['layout-mode'] ?? 1,        // 1: sizes in logical pixels (divided by the scale), 2: physical
        canMirror: props['supports-mirroring'] ?? true,
        monitors: monitors.map(([spec, modes, monitorProps]) => {
            const [connector, vendor, product, monitorSerial] = spec;
            const mp = Object.fromEntries(Object.entries(monitorProps).map(([k, v]) => [k, unpack(v)]));
            return {
                connector, vendor, product, serial: monitorSerial,
                name: mp['display-name'] || product || connector,
                builtin: !!mp['is-builtin'],
                modes: modes.map(([id, width, height, refresh, scale, scales, modeProps]) => {
                    const p = Object.fromEntries(Object.entries(modeProps).map(([k, v]) => [k, unpack(v)]));
                    return {id, width, height, refresh, scale, scales, current: !!p['is-current'], preferred: !!p['is-preferred']};
                }),
            };
        }),
        logical: logical.map(([x, y, scale, transform, primary, specs]) => ({
            x, y, scale, transform, primary, connectors: specs.map(spec => spec[0]),
        })),
    };
}

/** The mode a monitor shows now (or the one it prefers, for a monitor that is off). */
export function modeOf(monitor) {
    return monitor.modes.find(m => m.current) ?? monitor.modes.find(m => m.preferred) ?? monitor.modes[0] ?? null;
}

/** The size of a logical monitor on the desktop, as GNOME counts it. */
export function sizeOf(state, logical) {
    const monitor = state.monitors.find(m => m.connector === logical.connectors[0]);
    const mode = monitor && modeOf(monitor);
    if (!mode)
        return {w: 0, h: 0};
    let [w, h] = [mode.width, mode.height];
    if (logical.transform % 2 === 1)
        [w, h] = [h, w];
    if (state.layoutMode === 1) {
        w = Math.round(w / logical.scale);
        h = Math.round(h / logical.scale);
    }
    return {w, h};
}

/**
 * Applies a new arrangement. @param {object[]} logical as in currentState(), each monitor in it keeps the mode it has
 * (or a given `modes[connector]`). PERSISTENT is remembered by GNOME (as GNOME Settings does).
 */
export function applyLogical(state, logical, {method = Method.PERSISTENT, modes = {}} = {}) {
    const monitors = new Map(state.monitors.map(m => [m.connector, m]));
    const list = logical.map(l => [
        Math.round(l.x), Math.round(l.y), l.scale, l.transform, l.primary,
        l.connectors.map(connector => [connector, modes[connector] ?? modeOf(monitors.get(connector)).id, {}]),
    ]);
    const parameters = new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [state.serial, method, list, {}]);
    return call('ApplyMonitorsConfig', parameters);
}
