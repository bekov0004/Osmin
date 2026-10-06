import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const MAX_BYTES = 6 * 1024 * 1024;
const MAX_CACHE_FILES = 60;

/**
 * Turns an MPRIS `mpris:artUrl` into a local file: file:// URLs are used as
 * they are, http(s):// ones are downloaded once into the user cache dir
 * (~/.cache/osmin/artwork). Nothing is ever written elsewhere.
 */
export class ArtworkService {
    constructor() {
        this._session = new Soup.Session({timeout: 10, user_agent: 'Osmin/0.1'});
        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'osmin', 'artwork']);
        this._pending = new Map();
        this._cancellable = new Gio.Cancellable();
    }

    /** @returns {Promise<Gio.File|null>} */
    async resolve(url) {
        if (!url)
            return null;
        try {
            if (url.startsWith('file://'))
                return Gio.File.new_for_uri(url);
            if (url.startsWith('http://') || url.startsWith('https://')) {
                if (!this._pending.has(url))
                    this._pending.set(url, this._download(url).finally(() => this._pending.delete(url)));
                return await this._pending.get(url);
            }
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`[osmin] artwork ${url}: ${e.message}`);
        }
        return null;
    }

    destroy() {
        this._cancellable.cancel();
        this._session.abort();
        this._session = null;
    }

    async _download(url) {
        const name = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1);
        const file = Gio.File.new_for_path(GLib.build_filenamev([this._cacheDir, name]));
        if (file.query_exists(null))
            return file;

        const message = Soup.Message.new('GET', url);
        const bytes = await this._session.send_and_read_async(
            message, GLib.PRIORITY_LOW, this._cancellable);
        if (message.status_code !== Soup.Status.OK)
            throw new Error(`HTTP ${message.status_code}`);
        if (bytes.get_size() > MAX_BYTES)
            throw new Error('artwork too large');

        GLib.mkdir_with_parents(this._cacheDir, 0o700);
        await new Promise((resolve, reject) => {
            file.replace_contents_bytes_async(bytes, null, false,
                Gio.FileCreateFlags.NONE, this._cancellable, (f, res) => {
                    try {
                        f.replace_contents_finish(res);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
        });
        this._trimCache();
        return file;
    }

    /** Keeps the cache small: removes the oldest files beyond the limit. */
    _trimCache() {
        try {
            const dir = Gio.File.new_for_path(this._cacheDir);
            const infos = [];
            const enumerator = dir.enumerate_children(
                'standard::name,time::modified', Gio.FileQueryInfoFlags.NONE, null);
            for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null))
                infos.push([info.get_name(), info.get_attribute_uint64('time::modified')]);
            enumerator.close(null);
            infos.sort((a, b) => b[1] - a[1]);
            for (const [name] of infos.slice(MAX_CACHE_FILES))
                dir.get_child(name).delete(null);
        } catch (e) {
            console.warn(`[osmin] artwork cache cleanup failed: ${e.message}`);
        }
    }
}
