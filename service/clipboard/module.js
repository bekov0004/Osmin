import {Module} from '../module.js';
import {JsonStore} from '../lib/jsonStore.js';

/**
 * Where the clipboard history is kept on disk (~/.local/share/osmin/clipboard.json). The history
 * itself (capturing what is copied, ordering, pinning) lives in the shell, which is the only
 * place that can see the clipboard; it hands the items to keep over here and reads them back at
 * start. The extension decides what may be kept (pinned items and notes; the rest only if the
 * "keep history" setting is on).
 */
export class ClipboardModule extends Module {
    constructor() {
        super('Clipboard');
        this._store = new JsonStore('clipboard.json');
    }

    async rpc_load() {
        const data = this._store.load();
        return {items: Array.isArray(data?.items) ? data.items : []};
    }

    async rpc_save({items = []}) {
        this._store.save({version: 1, items});
    }
}
