import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {Module} from '../module.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const BASE = GLib.getenv('OSMIN_LYRICS_URL') || 'https://lrclib.net';
const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'osmin', 'lyrics']);
const MAX_CACHE_FILES = 200;

/** "[01:23.45] text" lines -> [{t: ms, text}] sorted by time */
export function parseLrc(lrc) {
    const lines = [];
    for (const raw of String(lrc ?? '').split('\n')) {
        const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
        if (stamps.length === 0)
            continue;
        const text = raw.replace(/\[[^\]]*\]/g, '').trim();
        for (const stamp of stamps)
            lines.push({t: Math.round((Number(stamp[1]) * 60 + Number(stamp[2])) * 1000), text});
    }
    return lines.sort((a, b) => a.t - b.t);
}

/**
 * Lyrics of the song that is playing, looked up on lrclib.net (a free lyrics database, no key):
 * the artist, title, album and length of the song are sent there, nothing else. Used only when the
 * user turns "show lyrics" on. The answers are kept in ~/.cache/osmin/lyrics.
 * rpc_lookup({artist, title, album, length}) -> {lines: [{t, text}] | null, plain: string | null}
 */
export class LyricsModule extends Module {
    constructor() {
        super('Lyrics');
        this._session = new Soup.Session({timeout: 8, user_agent: 'Osmin (https://github.com/bekov0004/Osmin)'});
        this._memory = new Map();
    }

    stop() {
        this._session.abort();
    }

    async rpc_lookup({artist = '', title = '', album = '', length = 0}) {
        title = String(title).trim();
        if (!title)
            return {lines: null, plain: null};
        const key = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, `${artist}\n${title}\n${album}\n${Math.round(length / 1e6)}`, -1);
        if (this._memory.has(key))
            return this._memory.get(key);
        const cached = this._readCache(key);
        if (cached) {
            this._memory.set(key, cached);
            return cached;
        }
        let result = {lines: null, plain: null};
        try {
            const found = await this._fetch(artist, title, album, length);
            if (found) {
                const lines = parseLrc(found.syncedLyrics);
                result = {lines: lines.length > 0 ? lines : null, plain: found.plainLyrics ?? null};
            }
            this._writeCache(key, result);
        } catch (e) {
            // offline or the service is down: nothing is cached, it is asked again next time
            console.warn(`[osmin-service] lyrics lookup failed: ${e.message}`);
            return {lines: null, plain: null};
        }
        this._memory.set(key, result);
        return result;
    }

    async _get(path, query) {
        const url = `${BASE}${path}?${Object.entries(query).filter(([, v]) => v !== '' && v !== 0).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
        const message = Soup.Message.new('GET', url);
        const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        if (message.status_code === 404)
            return null;
        if (message.status_code !== 200)
            throw new Error(`HTTP ${message.status_code}`);
        return JSON.parse(new TextDecoder().decode(bytes.get_data()));
    }

    async _fetch(artist, title, album, length) {
        const exact = await this._get('/api/get', {artist_name: artist, track_name: title, album_name: album, duration: Math.round(length / 1e6)});
        if (exact?.syncedLyrics || exact?.plainLyrics)
            return exact;
        const search = await this._get('/api/search', {track_name: title, artist_name: artist});
        return Array.isArray(search) ? search.find(r => r.syncedLyrics) ?? search.find(r => r.plainLyrics) ?? null : null;
    }

    _readCache(key) {
        try {
            return JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${CACHE_DIR}/${key}.json`)[1]));
        } catch (e) {
            return null;
        }
    }

    _writeCache(key, result) {
        try {
            GLib.mkdir_with_parents(CACHE_DIR, 0o700);
            GLib.file_set_contents(`${CACHE_DIR}/${key}.json`, JSON.stringify(result));
            const dir = Gio.File.new_for_path(CACHE_DIR);
            const files = [];
            const enumerator = dir.enumerate_children('standard::name,time::modified', Gio.FileQueryInfoFlags.NONE, null);
            for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null))
                files.push([info.get_name(), info.get_attribute_uint64('time::modified')]);
            files.sort((a, b) => b[1] - a[1]);
            for (const [name] of files.slice(MAX_CACHE_FILES))
                dir.get_child(name).delete(null);
        } catch (e) {
            console.warn(`[osmin-service] lyrics cache: ${e.message}`);
        }
    }
}
