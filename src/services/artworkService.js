import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
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
        this._colors = new Map();
        this._cancellable = new Gio.Cancellable();
    }

    /** @returns {Promise<Gio.File|null>} */
    async resolve(url) {
        if (!url)
            return null;
        try {
            if (url.startsWith('file://')) {
                const file = Gio.File.new_for_uri(url);
                return file.query_exists(null) ? file : null;
            }
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

    /**
     * A vivid colour of the picture (red, green, blue in 0..1), for tinting
     * effects. Weighs saturated pixels most, so grey borders do not win.
     * @param {Gio.File} file
     * @returns {number[]|null}
     */
    dominantColor(file) {
        const path = file?.get_path();
        if (!path)
            return null;
        if (this._colors.has(path))
            return this._colors.get(path);
        let color = null;
        try {
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(path, 24, 24);
            const pixels = pixbuf.get_pixels();
            const channels = pixbuf.get_n_channels();
            const stride = pixbuf.get_rowstride();
            let r = 0, g = 0, b = 0, total = 0;
            for (let y = 0; y < pixbuf.get_height(); y++) {
                for (let x = 0; x < pixbuf.get_width(); x++) {
                    const i = y * stride + x * channels;
                    const pr = pixels[i], pg = pixels[i + 1], pb = pixels[i + 2];
                    const sat = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
                    const weight = 1 + sat * sat / 64;
                    r += pr * weight;
                    g += pg * weight;
                    b += pb * weight;
                    total += weight;
                }
            }
            if (total > 0) {
                r /= total; g /= total; b /= total;
                // Lift dark colours so the effect stays visible on the black capsule.
                const top = Math.max(r, g, b, 1);
                const lift = Math.max(1, 190 / top);
                color = [Math.min(1, r * lift / 255), Math.min(1, g * lift / 255), Math.min(1, b * lift / 255)];
            }
        } catch (e) {
            console.warn(`[osmin] artwork colour: ${e.message}`);
        }
        this._colors.set(path, color);
        return color;
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
