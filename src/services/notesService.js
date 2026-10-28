import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const MAX_LENGTH = 1000;

/**
 * The quick notes as the widget sees them: a mirror of the Osmin service's notes (service/notes)
 * with the same calls. Signal: 'changed'.
 */
export class NotesService extends Signals.EventEmitter {
    /** @param {ModuleClient} module */
    constructor(module) {
        super();
        this._module = module;
        module.connect('state-changed', () => this.emit('changed'));
    }

    /** [{id, text, at}] newest first */
    get notes() {
        return this._module.state.notes ?? [];
    }

    /** The notes arrive from the service by itself. */
    load() {}

    /** @returns {boolean} whether a note is going to be added */
    add(text) {
        const trimmed = text.trim().slice(0, MAX_LENGTH);
        if (!trimmed)
            return false;
        this._module.call('add', {text: trimmed}).catch(e => console.warn(`[osmin] notes: ${e.message}`));
        return true;
    }

    remove(id) {
        this._module.call('remove', {id}).catch(e => console.warn(`[osmin] notes: ${e.message}`));
    }

    destroy() {}
}
