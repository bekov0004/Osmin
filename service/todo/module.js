import {Module} from '../module.js';
import {TodoService} from './todoService.js';

/** The to-do list. state: {items: [{id, text, done}]} */
export class TodoModule extends Module {
    constructor() {
        super('Todo');
        this._todo = new TodoService();
        this._todo.connect('changed', () => this.emitState());
    }

    get state() {
        return {items: this._todo.items};
    }

    start() {
        this._todo.load();
    }

    async rpc_add({text = ''}) {
        return {added: this._todo.add(String(text))};
    }

    async rpc_toggle({id}) {
        this._todo.toggle(id);
    }

    async rpc_remove({id}) {
        this._todo.remove(id);
    }

    async rpc_clearDone() {
        this._todo.clearDone();
    }
}
