import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Module} from '../module.js';

const PARTIAL = /\.(part|crdownload|download|opdownload|tmp|partial)$/i;
const QUIET_MS = 2500;       // a file that did not change for this long is done
const RECENT = 8;            // finished downloads kept in the list
const POLL_MS = 1000;

/**
 * Downloads: watches the Downloads folder (browsers write "name.part" / "name.crdownload" while a
 * file comes in and rename it when it is done; other programs just write the file). Shows what is
 * arriving, with its size and speed, and tells when it is done. It only looks at the folder; it
 * reads nothing of the files.
 *
 * state: {folder, items: [{name, path, size, speed, state: 'downloading'|'done', at}]}
 * events: started {name}, finished {name, path, size}
 */
export class DownloadsModule extends Module {
    constructor() {
        super('Downloads');
        this._folder = GLib.getenv('OSMIN_DOWNLOADS_DIR') ||
            GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ||
            GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);
        this._items = new Map();    // path -> {name, size, lastSize, lastChange, speed, state, at, partial}
        this._done = [];
        this._monitor = null;
        this._pollId = 0;
        this._startedAt = Date.now();
    }

    get state() {
        const active = [...this._items.values()].map(i => ({name: i.name, path: i.path, size: i.size, speed: i.speed, state: 'downloading', at: i.at}));
        return {folder: this._folder, items: [...active, ...this._done]};
    }

    start() {
        const folder = Gio.File.new_for_path(this._folder);
        if (!folder.query_exists(null))
            return;
        try {
            this._monitor = folder.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._monitor.connect('changed', (_m, file, other, event) => this._onChanged(file, other, event));
        } catch (e) {
            console.warn(`[osmin-service] cannot watch ${this._folder}: ${e.message}`);
        }
    }

    stop() {
        this._monitor?.cancel();
        this._monitor = null;
        if (this._pollId)
            GLib.source_remove(this._pollId);
        this._pollId = 0;
    }

    _size(path) {
        try {
            return Gio.File.new_for_path(path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
        } catch (e) {
            return -1;
        }
    }

    _onChanged(file, other, event) {
        const path = file.get_path();
        const name = file.get_basename();
        const E = Gio.FileMonitorEvent;
        if (!path)
            return;
        const hidden = name.startsWith('.') && !PARTIAL.test(name);
        if (hidden && event !== E.RENAMED && event !== E.MOVED)
            return;
        switch (event) {
        case E.CREATED:
        case E.CHANGED:
        case E.MOVED_IN:
            this._touch(path, name);
            break;
        case E.RENAMED: {
            // "x.part" renamed to "x": the download is done at once.
            const target = other?.get_path();
            const targetName = other?.get_basename() ?? '';
            if (target && !PARTIAL.test(targetName) && !targetName.startsWith('.') && (PARTIAL.test(name) || hidden || this._items.has(path) || name.startsWith(`${targetName}.`)))
                this._finish(path, target, targetName);   // a program wrote a temporary file and renamed it
            else if (target)
                this._items.delete(path);
            break;
        }
        case E.DELETED:
        case E.MOVED_OUT:
            this._items.delete(path);
            this.emitState();
            break;
        default:
            break;
        }
    }

    _touch(path, name) {
        const size = this._size(path);
        if (size < 0)
            return;
        const now = Date.now();
        let item = this._items.get(path);
        if (!item) {
            item = {path, name: name.replace(PARTIAL, ''), size, lastSize: size, lastChange: now, speed: 0, at: now, partial: PARTIAL.test(name), samples: now};
            this._items.set(path, item);
            this.emitEvent('started', {name: item.name});
        } else if (size !== item.size) {
            item.lastChange = now;
        }
        item.size = size;
        this._poll();
        this.emitState();
    }

    _finish(path, target, name) {
        const item = this._items.get(path);
        this._items.delete(path);
        this._complete(target, name, this._size(target), item?.at ?? Date.now());
    }

    _complete(path, name, size, at) {
        this._items.delete(path);
        this._done = [{name, path, size: Math.max(0, size), speed: 0, state: 'done', at: Date.now()}, ...this._done.filter(d => d.path !== path)].slice(0, RECENT);
        this.emitEvent('finished', {name, path, size});
        this.emitState();
    }

    /** Watches the files that are arriving once a second: speed, and "nothing new for a while" = done. */
    _poll() {
        if (this._pollId)
            return;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            const now = Date.now();
            for (const item of [...this._items.values()]) {
                const size = this._size(item.path);
                if (size < 0) {
                    this._items.delete(item.path);
                    continue;
                }
                item.speed = Math.max(0, (size - item.lastSize) * 1000 / POLL_MS);
                item.lastSize = size;
                if (size !== item.size) {
                    item.size = size;
                    item.lastChange = now;
                }
                // A partial file that stopped growing may be a paused download: keep it. A plain file
                // that did not change for a while is finished.
                if (!item.partial && now - item.lastChange >= QUIET_MS)
                    this._complete(item.path, item.name, size, item.at);
            }
            this.emitState();
            if (this._items.size === 0) {
                this._pollId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }
}
