import {Module} from '../module.js';
import {NotesService} from './notesService.js';

/** The quick notes. state: {notes: [{id, text, at}]} newest first */
export class NotesModule extends Module {
    constructor() {
        super('Notes');
        this._notes = new NotesService();
        this._notes.connect('changed', () => this.emitState());
    }

    get state() {
        return {notes: this._notes.notes};
    }

    start() {
        this._notes.load();
    }

    async rpc_add({text = ''}) {
        return {added: this._notes.add(String(text))};
    }

    async rpc_remove({id}) {
        this._notes.remove(id);
    }
}
