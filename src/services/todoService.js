import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const MAX_ITEMS = 200;
const MAX_LENGTH = 200;

/**
 * The to-do list as the widget sees it: a mirror of the Osmin service's list (service/todo) with
 * the same calls. Signal: 'changed'.
 */
export class TodoService extends Signals.EventEmitter {
    /** @param {ModuleClient} module */
    constructor(module) {
        super();
        this._module = module;
        module.connect('state-changed', () => this.emit('changed'));
    }

    /** [{id, text, done}] in the order they were added */
    get items() {
        return this._module.state.items ?? [];
    }

    get remaining() {
        return this.items.filter(item => !item.done).length;
    }

    get hasDone() {
        return this.items.some(item => item.done);
    }

    /** The list arrives from the service by itself. */
    load() {}

    /** @returns {boolean} whether a task is going to be added */
    add(text) {
        const trimmed = text.trim().slice(0, MAX_LENGTH);
        if (!trimmed || this.items.length >= MAX_ITEMS)
            return false;
        this._call('add', {text: trimmed});
        return true;
    }

    toggle(id) {
        this._call('toggle', {id});
    }

    remove(id) {
        this._call('remove', {id});
    }

    clearDone() {
        this._call('clearDone');
    }

    destroy() {}

    _call(method, args = {}) {
        this._module.call(method, args).catch(e => console.warn(`[osmin] to-do: ${e.message}`));
    }
}
