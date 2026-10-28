import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

/**
 * The file tray as the interface sees it: a persistent list of file:// URIs (the files themselves
 * are never copied or moved). The list, the thumbnails and the watching of the files live in the
 * Osmin service (service/files); opening a file, showing it in the file manager and putting it on
 * the clipboard stay here, because they must come from the shell (focus, clipboard).
 *
 * Signals: 'changed', 'adding' (count), 'added' (count of new files).
 */
export class FileService extends Signals.EventEmitter {
    /**
     * @param {ModuleClient} module
     * @param {{persist?: () => boolean}} [options] persist: whether the tray survives restarts
     */
    constructor(module, {persist = () => true} = {}) {
        super();
        this._module = module;
        this._persist = persist;
        this._items = [];
        this._cancellable = new Gio.Cancellable();
        this._source = null;
        module.connect('state-changed', () => this._onState());
        module.connect('event', (_m, name, payload) => {
            if (name === 'adding' || name === 'added')
                this.emit(name, payload.count);
        });
        // A restarted service has to be told again whether the tray is kept.
        module.connect('connected', () => this.load());
    }

    /** [{uri, name, icon (Gio.Icon), thumbnail (Gio.Icon|null), isDirectory}] */
    get items() {
        return this._items;
    }

    _onState() {
        this._items = (this._module.state.items ?? []).map(item => ({
            uri: item.uri,
            name: item.name,
            icon: this._icon(item.icon),
            thumbnail: item.thumbnail ? new Gio.FileIcon({file: Gio.File.new_for_path(item.thumbnail)}) : null,
            isDirectory: item.isDirectory,
        }));
        this.emit('changed');
    }

    _icon(serialized) {
        try {
            return serialized ? Gio.Icon.new_for_string(serialized) : Gio.ThemedIcon.new('text-x-generic');
        } catch (e) {
            return Gio.ThemedIcon.new('text-x-generic');
        }
    }

    /** The "keep files" setting changed: the service saves the tray now, or forgets the saved one. */
    persistChanged() {
        this._module.call('persistChanged', {persist: this._persist()}).catch(e => console.warn(`[osmin] tray: ${e.message}`));
    }

    /** Tells the service whether to keep the tray; the saved tray arrives with its state. */
    async load() {
        try {
            await this._module.call('init', {persist: this._persist()});
        } catch (e) {
            console.warn(`[osmin] loading the file tray failed: ${e.message}`);
        }
    }

    /** @returns {Promise<number>} how many files were new */
    async add(uris) {
        try {
            const {added} = await this._module.call('add', {uris});
            return added;
        } catch (e) {
            console.warn(`[osmin] adding to the tray failed: ${e.message}`);
            return 0;
        }
    }

    remove(uri) {
        this._module.call('remove', {uri}).catch(e => console.warn(`[osmin] tray: ${e.message}`));
    }

    clear() {
        this._module.call('clear').catch(e => console.warn(`[osmin] tray: ${e.message}`));
    }

    open(uri) {
        Gio.AppInfo.launch_default_for_uri_async(uri, null, this._cancellable, (_s, res) => {
            try {
                Gio.AppInfo.launch_default_for_uri_finish(res);
            } catch (e) {
                console.warn(`[osmin] could not open ${uri}: ${e.message}`);
            }
        });
    }

    /** Selects the file in the file manager (FileManager1), or opens its folder. */
    showInFolder(uri) {
        Gio.DBus.session.call('org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
            'org.freedesktop.FileManager1', 'ShowItems', new GLib.Variant('(ass)', [[uri], '']),
            null, Gio.DBusCallFlags.NONE, -1, this._cancellable, (connection, res) => {
                try {
                    connection.call_finish(res);
                } catch (e) {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return;
                    const parent = Gio.File.new_for_uri(uri).get_parent();
                    if (parent)
                        this.open(parent.get_uri());
                }
            });
    }

    /**
     * Puts the files on the clipboard as a standard `text/uri-list`, so they can
     * be pasted into file managers and other apps. (A shell extension cannot
     * start a drag into another application; this is the way to move a file out.)
     */
    copyToClipboard(uris) {
        const content = new GLib.Bytes(new TextEncoder().encode(`${uris.join('\r\n')}\r\n`));
        this._source = Meta.SelectionSourceMemory.new('text/uri-list', content);
        global.display.get_selection().set_owner(Meta.SelectionType.SELECTION_CLIPBOARD, this._source);
    }

    destroy() {
        this._cancellable.cancel();
        if (this._source) {
            global.display.get_selection().unset_owner(Meta.SelectionType.SELECTION_CLIPBOARD, this._source);
            this._source = null;
        }
        this._items = [];
    }
}
