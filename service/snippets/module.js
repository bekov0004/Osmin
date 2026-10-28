import {Module} from '../module.js';
import {JsonStore} from '../lib/jsonStore.js';

const MAX = 200;

/**
 * Text snippets: a short trigger (";mail") that stands for a longer text. They are kept in
 * ~/.local/share/osmin/snippets.json and used from the Search tab (type the trigger, press Enter:
 * the text is pasted where you were). state: {snippets: [{trigger, text}]}
 */
export class SnippetsModule extends Module {
    constructor() {
        super('Snippets');
        this._store = new JsonStore('snippets.json');
        this._snippets = [];
    }

    get state() {
        return {snippets: this._snippets};
    }

    start() {
        const data = this._store.load();
        this._snippets = Array.isArray(data?.snippets)
            ? data.snippets.filter(s => s && typeof s.trigger === 'string' && typeof s.text === 'string').slice(0, MAX) : [];
    }

    _save() {
        this._store.save({version: 1, snippets: this._snippets});
        this.emitState();
    }

    async rpc_add({trigger, text}) {
        trigger = String(trigger ?? '').trim();
        text = String(text ?? '');
        if (!trigger || !text)
            throw new Error('A snippet needs a trigger and a text');
        this._snippets = [{trigger, text: text.slice(0, 5000)}, ...this._snippets.filter(s => s.trigger !== trigger)].slice(0, MAX);
        this._save();
    }

    async rpc_remove({trigger}) {
        this._snippets = this._snippets.filter(s => s.trigger !== trigger);
        this._save();
    }
}
