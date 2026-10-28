import {Module} from '../module.js';
import {FileService} from './fileService.js';

/**
 * The file tray (a list of file:// URIs; the files are never copied or moved).
 * state: {items: [{uri, name, icon, thumbnail, isDirectory}]} where `icon` is a serialized Gio.Icon
 * and `thumbnail` a file path (or null).
 * events: adding {count}, added {count}
 */
export class FilesModule extends Module {
    constructor() {
        super('Files');
        this._persist = true;
        this._loaded = false;
        this._files = new FileService({persist: () => this._persist});
        this._files.connect('changed', () => this.emitState());
        this._files.connect('adding', (_f, count) => this.emitEvent('adding', {count}));
        this._files.connect('added', (_f, count) => this.emitEvent('added', {count}));
    }

    get state() {
        return {
            items: this._files.items.map(item => ({
                uri: item.uri,
                name: item.name,
                icon: item.icon?.to_string() ?? null,
                thumbnail: item.thumbnail?.get_file()?.get_path() ?? null,
                isDirectory: item.isDirectory,
            })),
        };
    }

    stop() {
        this._files.destroy();
    }

    /** The extension says whether the tray is kept between sessions; the saved tray is read once. */
    async rpc_init({persist}) {
        this._persist = persist !== false;
        if (this._loaded) {
            this._files.persistChanged();
            return;
        }
        this._loaded = true;
        await this._files.load();
    }

    async rpc_persistChanged({persist}) {
        this._persist = persist !== false;
        this._files.persistChanged();
    }

    async rpc_add({uris = []}) {
        return {added: await this._files.add(uris.filter(uri => typeof uri === 'string'))};
    }

    async rpc_remove({uri}) {
        this._files.remove(uri);
    }

    async rpc_clear() {
        this._files.clear();
    }
}
