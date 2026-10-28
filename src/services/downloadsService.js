import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

/**
 * The Downloads folder as the interface sees it: what is arriving and what arrived lately,
 * mirrored from the Osmin service (service/downloads).
 * Signals: 'changed', 'started' ({name}), 'finished' ({name, path, size}).
 */
export class DownloadsService extends Signals.EventEmitter {
    /** @param {ModuleClient} module */
    constructor(module) {
        super();
        this._module = module;
        module.connect('state-changed', () => this.emit('changed'));
        module.connect('event', (_m, name, payload) => {
            if (name === 'started' || name === 'finished')
                this.emit(name, payload);
        });
    }

    /** [{name, path, size, speed, state: 'downloading'|'done', at}] */
    get items() {
        return this._module.state.items ?? [];
    }

    get active() {
        return this.items.filter(item => item.state === 'downloading');
    }

    destroy() {}
}
