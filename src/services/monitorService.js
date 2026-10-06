import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SignalTracker} from '../utils/signals.js';

/** Resolves which monitor the island lives on and reports layout changes. */
export class MonitorService {
    constructor(onChanged) {
        this._signals = new SignalTracker();
        this._signals.connect(Main.layoutManager, 'monitors-changed', onChanged);
    }

    /** The primary monitor (rect with x, y, width, height). */
    getMonitor() {
        return Main.layoutManager.primaryMonitor;
    }

    /** Y coordinate right below the top bar of the target monitor. */
    getTopEdge() {
        const monitor = this.getMonitor();
        const panelBox = Main.layoutManager.panelBox;
        if (panelBox.visible && panelBox.y <= monitor.y + 1)
            return monitor.y + panelBox.height;
        return monitor.y;
    }

    destroy() {
        this._signals.disconnectAll();
    }
}
