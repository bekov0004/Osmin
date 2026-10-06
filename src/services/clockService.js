import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';

/**
 * Calls `onTick(GLib.DateTime)` right after start() and then whenever the
 * minute (or the time zone) changes. Uses the same WallClock as the GNOME
 * date menu, so it follows suspend/resume and system time changes.
 */
export class ClockService {
    constructor(onTick) {
        this._onTick = onTick;
        this._clock = null;
        this._ids = [];
    }

    start() {
        if (this._clock)
            return;
        this._clock = new GnomeDesktop.WallClock();
        for (const name of ['notify::clock', 'notify::timezone'])
            this._ids.push(this._clock.connect(name, () => this._tick()));
        this._tick();
    }

    _tick() {
        this._onTick(GLib.DateTime.new_now_local());
    }

    destroy() {
        if (!this._clock)
            return;
        for (const id of this._ids)
            this._clock.disconnect(id);
        this._ids = [];
        this._clock = null;
    }
}
