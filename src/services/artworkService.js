import Gio from 'gi://Gio';

/**
 * Turns an MPRIS `mpris:artUrl` into a local file and finds a vivid colour of the picture. The
 * downloading (into the user cache dir) and the colour analysis are done by the Osmin service
 * (service/artwork), so a slow cover server never stalls the shell.
 */
export class ArtworkService {
    /** @param {ModuleClient} module */
    constructor(module) {
        this._module = module;
        this._colors = new Map(); // local path -> [r, g, b] in 0..1, or null
        this._results = new Map(); // url -> Promise<Gio.File|null>
    }

    /** @returns {Promise<Gio.File|null>} */
    resolve(url) {
        if (!url)
            return Promise.resolve(null);
        if (!this._results.has(url)) {
            this._results.set(url, this._module.call('resolve', {url}).then(({path, color}) => {
                if (!path)
                    return null;
                this._colors.set(path, color);
                return Gio.File.new_for_path(path);
            }, e => {
                console.warn(`[osmin] artwork ${url}: ${e.message}`);
                this._results.delete(url);
                return null;
            }));
        }
        return this._results.get(url);
    }

    /**
     * A vivid colour of the picture (red, green, blue in 0..1), for tinting effects: the one the
     * service found when it resolved the file.
     * @param {Gio.File} file
     * @returns {number[]|null}
     */
    dominantColor(file) {
        return this._colors.get(file?.get_path()) ?? null;
    }

    destroy() {
        this._results.clear();
        this._colors.clear();
    }
}
