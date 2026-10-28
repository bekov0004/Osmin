import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * A tiny JSON file in the user's data dir (~/.local/share/osmin/<name>).
 * Reads and writes are synchronous on purpose: the files are a few hundred
 * bytes, writes happen on user actions only, and a synchronous atomic
 * replace cannot be reordered with another write (which an asynchronous
 * one could, losing the newest state).
 */
export class JsonStore {
    constructor(name) {
        this._path = GLib.build_filenamev([GLib.get_user_data_dir(), 'osmin', name]);
    }

    /** @returns {object|null} the parsed file, or null if missing or broken */
    load() {
        try {
            const [, contents] = Gio.File.new_for_path(this._path).load_contents(null);
            return JSON.parse(new TextDecoder().decode(contents));
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.warn(`[osmin-service] reading ${this._path} failed: ${e.message}`);
            return null;
        }
    }

    save(data) {
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(this._path), 0o700);
            Gio.File.new_for_path(this._path).replace_contents(
                new TextEncoder().encode(JSON.stringify(data)), null, false,
                Gio.FileCreateFlags.PRIVATE, null);
        } catch (e) {
            console.warn(`[osmin-service] saving ${this._path} failed: ${e.message}`);
        }
    }
}
