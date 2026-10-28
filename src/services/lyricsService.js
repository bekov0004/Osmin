/**
 * The lyrics of the song that plays: looked up by the Osmin service (service/lyrics) on lrclib.net
 * and kept in memory here. Synced lyrics come as lines with a time.
 */
export class LyricsService {
    /** @param {ModuleClient} module */
    constructor(module) {
        this._module = module;
        this._results = new Map(); // key -> Promise<{lines, plain}>
    }

    /**
     * @param {{title: string, artist: string, album: string, length: number}} metadata length in µs
     * @returns {Promise<{lines: {t: number, text: string}[]|null, plain: string|null}>}
     */
    lookup({title, artist, album, length}) {
        const key = `${artist}\n${title}\n${album}\n${length}`;
        if (!this._results.has(key)) {
            this._results.set(key, this._module.call('lookup', {title, artist, album, length}).catch(e => {
                console.warn(`[osmin] lyrics: ${e.message}`);
                this._results.delete(key);
                return {lines: null, plain: null};
            }));
        }
        return this._results.get(key);
    }

    destroy() {
        this._results.clear();
    }
}

/** The line that is sung at `positionMs` (the last one that started), or null before the first. */
export function currentLine(lines, positionMs) {
    let found = null;
    for (const line of lines) {
        if (line.t > positionMs)
            break;
        found = line;
    }
    return found;
}
