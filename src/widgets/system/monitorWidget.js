import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {Sparkline} from '../../ui/sparkline.js';
import {menuCard, menuDivider, menuRow} from '../../ui/menuKit.js';
import {OsminWidget} from '../widget.js';

/**
 * The common part of the monitoring tabs (System, Network, Disks, Power): they read the numbers
 * the Osmin service samples, ask it to sample often while the tab is open, and redraw on every
 * new sample. A subclass builds its view and implements _update(state).
 */
export class MonitorWidget extends OsminWidget {
    static menuNative = true;

    constructor(context) {
        super(context);
        this._system = context.services.system;
        this._watching = false;
    }

    createView() {
        const root = this.createPage();
        this._system.connectObject('changed', () => this._refresh(), this);
        return root;
    }

    onViewCreated() {
        this._refresh();
    }

    onPageShown() {
        if (!this._watching) {
            this._watching = true;
            this._system.watch(true);
        }
        this._refresh();
    }

    onPageHidden() {
        if (this._watching) {
            this._watching = false;
            this._system.watch(false);
        }
    }

    _refresh() {
        const state = this._system.state;
        if (this._view && state && state.cpu !== undefined)
            this._update(state);
    }

    /** A graph with its top value in a small tag on the dotted line. @returns {{actor: St.Widget, graph: Sparkline, scale: St.Label}} */
    graphBlock(options) {
        const actor = new St.Widget({x_expand: true, layout_manager: new Clutter.BinLayout(), style_class: 'osmin-graph'});
        const graph = new Sparkline({...options, label: () => ''});
        actor.add_child(graph);
        const scale = new St.Label({text: '', style_class: 'osmin-graph-scale', x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.START});
        actor.add_child(scale);
        return {actor, graph, scale};
    }

    destroy() {
        this._system.disconnectObject(this);
        this.onPageHidden();
        super.destroy();
    }
}

export {menuCard, menuDivider, menuRow};

/** 93784 -> "1d 2h", 3700 -> "1h 1m". */
export function formatDuration(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds % 86400 / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    if (days > 0)
        return `${days}d ${hours}h`;
    if (hours > 0)
        return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}
