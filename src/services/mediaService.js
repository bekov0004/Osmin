import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const ROOT_IFACE = 'org.mpris.MediaPlayer2';

export const PlaybackStatus = Object.freeze({
    PLAYING: 'Playing',
    PAUSED: 'Paused',
    STOPPED: 'Stopped',
});

function callAsync(proxy, method, parameters = null) {
    proxy.call(method, parameters, Gio.DBusCallFlags.NONE, -1, null, (p, res) => {
        try {
            p.call_finish(res);
        } catch (e) {
            console.warn(`[osmin] MPRIS ${method} failed: ${e.message}`);
        }
    });
}

/** One MPRIS player on the session bus. */
export class MprisPlayer extends Signals.EventEmitter {
    constructor(busName) {
        super();
        this.busName = busName;
        this.ready = false;
        this.lastPlayedAt = 0;
        this._player = null;
        this._root = null;
        this._cancellable = new Gio.Cancellable();
        this._positionUs = 0;
        this._positionAt = GLib.get_monotonic_time();
        this._extrapolate = false; // whether `position` advances with the clock
        this._init().catch(e => {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`[osmin] MPRIS ${busName}: ${e.message}`);
        });
    }

    get status() {
        return this._prop('PlaybackStatus') ?? PlaybackStatus.STOPPED;
    }

    get isPlaying() {
        return this.status === PlaybackStatus.PLAYING;
    }

    get identity() {
        return this._rootProp('Identity') ?? this.busName.slice(MPRIS_PREFIX.length);
    }

    /** {title, artist, album, artUrl, length (µs), trackId} */
    get metadata() {
        const raw = this._prop('Metadata') ?? {};
        const artist = raw['xesam:artist'];
        return {
            title: raw['xesam:title'] ?? '',
            artist: Array.isArray(artist) ? artist.join(', ') : (artist ?? ''),
            album: raw['xesam:album'] ?? '',
            artUrl: raw['mpris:artUrl'] ?? '',
            length: Number(raw['mpris:length'] ?? 0),
            trackId: raw['mpris:trackid'] ?? null,
        };
    }

    get canGoNext() {
        return this._prop('CanGoNext') ?? false;
    }

    get canGoPrevious() {
        return this._prop('CanGoPrevious') ?? false;
    }

    get canSeek() {
        return this._prop('CanSeek') ?? false;
    }

    /** Position in µs, extrapolated between D-Bus reads. */
    get position() {
        let position = this._positionUs;
        if (this._extrapolate) {
            const rate = this._prop('Rate') ?? 1;
            position += (GLib.get_monotonic_time() - this._positionAt) * rate;
        }
        const {length} = this.metadata;
        return Math.max(0, length > 0 ? Math.min(position, length) : position);
    }

    playPause() {
        callAsync(this._player, 'PlayPause');
    }

    next() {
        callAsync(this._player, 'Next');
    }

    previous() {
        callAsync(this._player, 'Previous');
    }

    /** @param {number} positionUs absolute position in µs */
    seekTo(positionUs) {
        const {trackId} = this.metadata;
        if (!trackId || !this.canSeek)
            return;
        callAsync(this._player, 'SetPosition', new GLib.Variant('(ox)', [trackId, Math.round(positionUs)]));
        this._setPosition(positionUs);
    }

    /** Reads the real position from the player (it does not emit changes). */
    syncPosition() {
        if (!this.ready)
            return;
        Gio.DBus.session.call(this.busName, MPRIS_PATH, 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']), new GLib.VariantType('(v)'),
            Gio.DBusCallFlags.NONE, 1000, this._cancellable, (connection, res) => {
                try {
                    const [value] = connection.call_finish(res).recursiveUnpack();
                    this._setPosition(Number(value));
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.debug(`[osmin] MPRIS position: ${e.message}`);
                }
            });
    }

    destroy() {
        this._cancellable.cancel();
        this._player?.disconnectObject(this);
        this._player = this._root = null;
    }

    async _init() {
        const newProxy = iface => new Promise((resolve, reject) => {
            Gio.DBusProxy.new(Gio.DBus.session, Gio.DBusProxyFlags.NONE, null,
                this.busName, MPRIS_PATH, iface, this._cancellable, (source, res) => {
                    try {
                        resolve(Gio.DBusProxy.new_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
        });
        [this._player, this._root] = await Promise.all([newProxy(PLAYER_IFACE), newProxy(ROOT_IFACE)]);

        this._player.connectObject(
            'g-properties-changed', (_proxy, changed) => this._onPropertiesChanged(changed),
            'g-signal', (_proxy, _sender, signal, parameters) => {
                if (signal === 'Seeked')
                    this._setPosition(Number(parameters.deepUnpack()[0]));
            }, this);

        this.ready = true;
        if (this.isPlaying)
            this.lastPlayedAt = GLib.get_monotonic_time();
        this._extrapolate = this.isPlaying;
        this.syncPosition();
        this.emit('ready');
    }

    _onPropertiesChanged(changed) {
        const names = Object.keys(changed.recursiveUnpack());
        if (names.includes('PlaybackStatus')) {
            if (this.isPlaying)
                this.lastPlayedAt = GLib.get_monotonic_time();
            // Re-base with the old clock state, then follow the new one; the
            // real position is fetched right after.
            this._setPosition(this.position);
            this._extrapolate = this.isPlaying;
            this.syncPosition();
        }
        if (names.includes('Metadata')) {
            this._setPosition(0);
            this.syncPosition();
        }
        this.emit('changed', names);
    }

    _setPosition(positionUs) {
        this._positionUs = positionUs;
        this._positionAt = GLib.get_monotonic_time();
        this.emit('position-synced');
    }

    _prop(name) {
        return this._player?.get_cached_property(name)?.recursiveUnpack() ?? null;
    }

    _rootProp(name) {
        return this._root?.get_cached_property(name)?.recursiveUnpack() ?? null;
    }
}

/**
 * Finds every MPRIS player on the session bus and picks the active one:
 * a playing player (the one that started last), else the most recently
 * playing paused one, else any player that has a track.
 *
 * Signals: 'active-changed' (player|null), 'status-changed' (player),
 * 'track-changed' (player), 'players-changed'.
 */
export class MediaService extends Signals.EventEmitter {
    constructor() {
        super();
        this._players = new Map();
        this._active = null;
        this._lastTrack = null;
        this._lastStatus = null;
        this._subscription = 0;
        this._cancellable = new Gio.Cancellable();
    }

    get active() {
        return this._active;
    }

    get players() {
        return [...this._players.values()];
    }

    start() {
        this._subscription = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _n, parameters) => {
                const [name, oldOwner, newOwner] = parameters.deepUnpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                if (oldOwner)
                    this._removePlayer(name);
                if (newOwner)
                    this._addPlayer(name);
            });

        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames', null, new GLib.VariantType('(as)'),
            Gio.DBusCallFlags.NONE, -1, this._cancellable, (connection, res) => {
                try {
                    const [names] = connection.call_finish(res).deepUnpack();
                    names.filter(n => n.startsWith(MPRIS_PREFIX)).forEach(n => this._addPlayer(n));
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`[osmin] listing MPRIS players failed: ${e.message}`);
                }
            });
    }

    destroy() {
        this._cancellable.cancel();
        if (this._subscription)
            Gio.DBus.session.signal_unsubscribe(this._subscription);
        this._subscription = 0;
        for (const player of this._players.values())
            player.destroy();
        this._players.clear();
        this._active = null;
    }

    _addPlayer(name) {
        if (this._players.has(name))
            return;
        const player = new MprisPlayer(name);
        player.connectObject(
            'ready', () => this._reevaluate(),
            'changed', () => this._reevaluate(), this);
        this._players.set(name, player);
        this.emit('players-changed');
    }

    _removePlayer(name) {
        const player = this._players.get(name);
        if (!player)
            return;
        player.disconnectObject(this);
        player.destroy();
        this._players.delete(name);
        this.emit('players-changed');
        this._reevaluate();
    }

    _pick() {
        const ready = this.players.filter(p => p.ready);
        const byRecent = (a, b) => b.lastPlayedAt - a.lastPlayedAt;
        const playing = ready.filter(p => p.isPlaying).sort(byRecent);
        if (playing.length)
            return playing[0];
        const withTrack = ready.filter(p => p.metadata.title).sort(byRecent);
        return withTrack[0] ?? ready[0] ?? null;
    }

    _reevaluate() {
        const active = this._pick();
        const changedPlayer = active !== this._active;
        this._active = active;
        if (changedPlayer)
            this.emit('active-changed', active);
        if (!active) {
            this._lastTrack = this._lastStatus = null;
            return;
        }

        const {title, artist, trackId} = active.metadata;
        const track = `${active.busName}|${trackId ?? ''}|${title}|${artist}`;
        const status = `${active.busName}|${active.status}`;
        if (track !== this._lastTrack) {
            this._lastTrack = track;
            if (title)
                this.emit('track-changed', active);
        }
        if (status !== this._lastStatus) {
            this._lastStatus = status;
            this.emit('status-changed', active);
        }
        this.emit('state-changed', active);
    }
}
