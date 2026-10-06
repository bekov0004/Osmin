import GLib from 'gi://GLib';

/** Named one-shot timeouts that are all cancelled on destroy(). */
export class Timers {
    constructor() {
        this._sources = new Map();
        this._destroyed = false;
    }

    set(name, ms, callback) {
        if (this._destroyed)
            return;
        this.clear(name);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._sources.delete(name);
            callback();
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(id, `[osmin] ${name}`);
        this._sources.set(name, id);
    }

    has(name) {
        return this._sources.has(name);
    }

    clear(name) {
        const id = this._sources.get(name);
        if (id === undefined)
            return;
        GLib.source_remove(id);
        this._sources.delete(name);
    }

    destroy() {
        this._destroyed = true;
        for (const id of this._sources.values())
            GLib.source_remove(id);
        this._sources.clear();
    }
}
