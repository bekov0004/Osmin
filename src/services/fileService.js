import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {JsonStore} from '../utils/jsonStore.js';

const INFO_ATTRIBUTES = [
    'standard::display-name', 'standard::icon', 'standard::content-type',
    'standard::type', 'standard::size', 'thumbnail::path',
].join(',');
const MAX_DIRECT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 60;

/**
 * The file tray: a persistent list of file:// URIs (the files themselves are
 * never copied or moved). Entries disappear when the user removes them or when
 * the file is deleted / moved / renamed.
 *
 * Signals: 'changed', 'adding' (count), 'added' (count of new files).
 */
export class FileService extends Signals.EventEmitter {
    /** @param {{persist?: () => boolean}} [options] persist: whether the tray survives restarts */
    constructor({persist = () => true} = {}) {
        super();
        this._persist = persist;
        this._items = [];
        this._monitors = new Map();
        this._cancellable = new Gio.Cancellable();
        this._store = new JsonStore('tray.json');
        this._loaded = false;
        this._source = null;
    }

    /** [{uri, name, icon (Gio.Icon), thumbnail (Gio.Icon|null), isDirectory}] */
    get items() {
        return this._items;
    }

    /** The "keep files" setting changed: save the tray now, or forget the saved one. */
    persistChanged() {
        this._save();
    }

    async load() {
        if (!this._persist()) {
            this._save(); // forget what an earlier session kept
            this.emit('changed');
            return;
        }
        const data = this._store.load();
        const uris = Array.isArray(data?.files) ? data.files.filter(u => typeof u === 'string') : [];
        for (const uri of uris)
            await this._addItem(uri, {save: false});
        this._loaded = true;
        if (this._items.length !== uris.length)
            this._save();
        this.emit('changed');
    }

    /** @returns {Promise<number>} how many files were new */
    async add(uris) {
        this.emit('adding', uris.length);
        let added = 0;
        for (const uri of uris) {
            if (await this._addItem(uri, {save: false}))
                added++;
        }
        if (added > 0) {
            this._save();
            this.emit('changed');
        }
        this.emit('added', added);
        return added;
    }

    remove(uri) {
        const index = this._items.findIndex(item => item.uri === uri);
        if (index < 0)
            return;
        this._items.splice(index, 1);
        this._unmonitor(uri);
        this._save();
        this.emit('changed');
    }

    clear() {
        for (const item of this._items)
            this._unmonitor(item.uri);
        this._items = [];
        this._save();
        this.emit('changed');
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

    /** Opens GNOME's Bluetooth "send files" dialog for the files. */
    sendViaBluetooth(uris) {
        const paths = uris.map(uri => Gio.File.new_for_uri(uri).get_path()).filter(Boolean);
        if (paths.length === 0)
            return;
        try {
            GLib.spawn_async(null, ['bluetooth-sendto', ...paths], null, GLib.SpawnFlags.SEARCH_PATH, null);
        } catch (e) {
            console.warn(`[osmin] bluetooth-sendto failed: ${e.message}`);
        }
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
        for (const monitor of this._monitors.values())
            monitor.cancel();
        this._monitors.clear();
        if (this._source) {
            global.display.get_selection().unset_owner(Meta.SelectionType.SELECTION_CLIPBOARD, this._source);
            this._source = null;
        }
        this._items = [];
    }

    async _addItem(uri, {save}) {
        if (!uri.startsWith('file://') || this._items.some(item => item.uri === uri))
            return false;
        if (this._items.length >= MAX_ITEMS)
            return false;
        const file = Gio.File.new_for_uri(uri);
        let info;
        try {
            info = await new Promise((resolve, reject) => {
                file.query_info_async(INFO_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE,
                    GLib.PRIORITY_DEFAULT, this._cancellable, (f, res) => {
                        try {
                            resolve(f.query_info_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    });
            });
        } catch (e) {
            return false; // missing or unreadable: not worth keeping
        }

        this._items.push(this._describe(uri, file, info));
        this._monitor(uri, file);
        if (save)
            this._save();
        return true;
    }

    _describe(uri, file, info) {
        let thumbnail = null;
        const thumbPath = info.get_attribute_byte_string('thumbnail::path');
        if (thumbPath) {
            thumbnail = new Gio.FileIcon({file: Gio.File.new_for_path(thumbPath)});
        } else if (info.get_content_type()?.startsWith('image/') &&
                   info.get_size() < MAX_DIRECT_IMAGE_BYTES) {
            thumbnail = new Gio.FileIcon({file});
        }
        return {
            uri,
            name: info.get_display_name(),
            icon: info.get_icon(),
            thumbnail,
            isDirectory: info.get_file_type() === Gio.FileType.DIRECTORY,
        };
    }

    _monitor(uri, file) {
        try {
            const monitor = file.monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
            monitor.connect('changed', (_m, _file, _other, event) => {
                if ([Gio.FileMonitorEvent.DELETED, Gio.FileMonitorEvent.MOVED_OUT,
                    Gio.FileMonitorEvent.RENAMED, Gio.FileMonitorEvent.MOVED].includes(event))
                    this.remove(uri);
            });
            this._monitors.set(uri, monitor);
        } catch (e) {
            console.debug(`[osmin] cannot watch ${uri}: ${e.message}`);
        }
    }

    _unmonitor(uri) {
        this._monitors.get(uri)?.cancel();
        this._monitors.delete(uri);
    }

    _save() {
        this._store.save({
            version: 1,
            files: this._persist() ? this._items.map(item => item.uri) : [],
        });
    }
}
