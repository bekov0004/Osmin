import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {JsonStore} from '../utils/jsonStore.js';

const MAX_ITEMS = 200;
const MAX_LENGTH = 200;

/**
 * A local to-do list saved in ~/.local/share/osmin/todo.json. No account,
 * no sync. Signal: 'changed'.
 */
export class TodoService extends Signals.EventEmitter {
    constructor() {
        super();
        this._store = new JsonStore('todo.json');
        this._items = [];
        this._nextId = 1;
    }

    /** [{id, text, done}] in the order they were added */
    get items() {
        return this._items;
    }

    get remaining() {
        return this._items.filter(item => !item.done).length;
    }

    get hasDone() {
        return this._items.some(item => item.done);
    }

    load() {
        const data = this._store.load();
        if (Array.isArray(data?.items)) {
            this._items = data.items
                .filter(item => item && typeof item.text === 'string')
                .map(item => ({id: Number(item.id) || 0, text: item.text, done: item.done === true}))
                .slice(0, MAX_ITEMS);
            this._nextId = 1 + Math.max(0, ...this._items.map(item => item.id));
            // Make sure ids are unique even if the file was edited by hand.
            const seen = new Set();
            for (const item of this._items) {
                if (item.id <= 0 || seen.has(item.id))
                    item.id = this._nextId++;
                seen.add(item.id);
            }
        }
        this.emit('changed');
    }

    /** @returns {boolean} whether a task was added */
    add(text) {
        const trimmed = text.trim().slice(0, MAX_LENGTH);
        if (!trimmed || this._items.length >= MAX_ITEMS)
            return false;
        this._items.push({id: this._nextId++, text: trimmed, done: false});
        this._changed();
        return true;
    }

    toggle(id) {
        const item = this._items.find(i => i.id === id);
        if (!item)
            return;
        item.done = !item.done;
        this._changed();
    }

    remove(id) {
        const index = this._items.findIndex(i => i.id === id);
        if (index < 0)
            return;
        this._items.splice(index, 1);
        this._changed();
    }

    clearDone() {
        this._items = this._items.filter(item => !item.done);
        this._changed();
    }

    destroy() {}

    _changed() {
        this._store.save({version: 1, items: this._items});
        this.emit('changed');
    }
}
