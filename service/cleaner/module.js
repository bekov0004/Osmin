import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Module} from '../module.js';

const CACHE_ROOT = GLib.getenv('OSMIN_CACHE_DIR') || GLib.get_user_cache_dir();

const sizeOf = file => {
    let total = 0;
    try {
        const info = file.query_info('standard::type,standard::size', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        total += info.get_size();
        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
            const children = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            for (let child = children.next_file(null); child; child = children.next_file(null))
                total += sizeOf(file.get_child(child.get_name()));
        }
    } catch (e) {
        // unreadable: not counted
    }
    return total;
};

const removeTree = file => {
    const info = file.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
        const children = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        for (let child = children.next_file(null); child; child = children.next_file(null))
            removeTree(file.get_child(child.get_name()));
    }
    file.delete(null);
};

/**
 * The cache cleaner: shows which folders in the user's cache (~/.cache) are biggest and empties one
 * on request. Caches are made again by the programs that own them, so nothing of yours is lost.
 * Only a direct subfolder of the cache folder can be emptied (the folder itself stays).
 * rpc_scan() -> {folders: [{name, path, size}]}; rpc_clean({path}) -> {freed}
 */
export class CleanerModule extends Module {
    constructor() {
        super('Cleaner');
    }

    async rpc_scan() {
        const folders = [];
        const root = Gio.File.new_for_path(CACHE_ROOT);
        try {
            const children = root.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            for (let info = children.next_file(null); info; info = children.next_file(null)) {
                if (info.get_file_type() !== Gio.FileType.DIRECTORY)
                    continue;
                const file = root.get_child(info.get_name());
                folders.push({name: info.get_name(), path: file.get_path(), size: sizeOf(file)});
            }
        } catch (e) {
            // no cache folder
        }
        folders.sort((a, b) => b.size - a.size);
        return {folders: folders.filter(f => f.size > 0).slice(0, 10)};
    }

    async rpc_clean({path}) {
        const target = Gio.File.new_for_path(String(path));
        const parent = target.get_parent();
        // Only a folder directly inside the cache folder, never the cache folder itself or anything else.
        if (!parent || parent.get_path() !== Gio.File.new_for_path(CACHE_ROOT).get_path())
            throw new Error('That is not a folder of the cache');
        const info = target.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        if (info.get_file_type() !== Gio.FileType.DIRECTORY)
            throw new Error('That is not a folder');
        const before = sizeOf(target);
        const children = target.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        for (let child = children.next_file(null); child; child = children.next_file(null)) {
            try {
                removeTree(target.get_child(child.get_name()));
            } catch (e) {
                console.warn(`[osmin-service] cleaner: ${e.message}`);
            }
        }
        return {freed: before - sizeOf(target)};
    }
}
