import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** Setting value meaning "the primary monitor, whichever it is". */
export const PRIMARY = 'primary';

/** The monitor's index for a setting entry ('primary' or a connector name such as 'HDMI-1'), or -1. */
export function monitorIndexFor(id) {
    if (id === PRIMARY)
        return Main.layoutManager.primaryIndex;
    try {
        const index = global.backend.get_monitor_manager().get_monitor_for_connector(id);
        return Number.isInteger(index) && index >= 0 && index < Main.layoutManager.monitors.length ? index : -1;
    } catch (e) {
        return -1;
    }
}

/**
 * The monitors Osmin should be shown on: the entries of the `monitors` setting that exist now,
 * as unique indices, the primary monitor first when it is among them. Never empty: when none of
 * the entries is connected (the screen was unplugged) the primary monitor is used.
 */
export function targetMonitors(ids) {
    const found = new Set();
    for (const id of ids ?? [PRIMARY]) {
        const index = monitorIndexFor(id);
        if (index >= 0)
            found.add(index);
    }
    if (found.size === 0)
        found.add(Main.layoutManager.primaryIndex);
    const primary = Main.layoutManager.primaryIndex;
    return [...found].sort((a, b) => (b === primary) - (a === primary) || a - b);
}
