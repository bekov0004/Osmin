import {EventEmitter} from '../lib/signals.js';

import {JsonStore} from '../lib/jsonStore.js';

const MAX_NOTES = 100;
const MAX_LENGTH = 1000;

/**
 * Quick notes saved in ~/.local/share/osmin/notes.json, newest first. No account,
 * no sync. Signal: 'changed'.
 */
export class NotesService extends EventEmitter {
    constructor() {
        super();
        this._store = new JsonStore('notes.json');
        this._notes = [];
        this._nextId = 1;
    }

    /** [{id, text, at}] newest first */
    get notes() {
        return this._notes;
    }

    load() {
        const data = this._store.load();
        if (Array.isArray(data?.notes)) {
            this._notes = data.notes
                .filter(note => note && typeof note.text === 'string')
                .map(note => ({id: Number(note.id) || 0, text: note.text.slice(0, MAX_LENGTH), at: Number(note.at) || 0}))
                .slice(0, MAX_NOTES);
            this._nextId = 1 + Math.max(0, ...this._notes.map(note => note.id));
            const seen = new Set();
            for (const note of this._notes) {
                if (note.id <= 0 || seen.has(note.id))
                    note.id = this._nextId++;
                seen.add(note.id);
            }
        }
        this.emit('changed');
    }

    /** @returns {boolean} whether a note was added */
    add(text) {
        const trimmed = text.trim().slice(0, MAX_LENGTH);
        if (!trimmed)
            return false;
        this._notes.unshift({id: this._nextId++, text: trimmed, at: Date.now()});
        this._notes.length = Math.min(this._notes.length, MAX_NOTES);
        this._changed();
        return true;
    }

    remove(id) {
        const index = this._notes.findIndex(n => n.id === id);
        if (index < 0)
            return;
        this._notes.splice(index, 1);
        this._changed();
    }

    destroy() {}

    _changed() {
        this._store.save({version: 1, notes: this._notes});
        this.emit('changed');
    }
}
