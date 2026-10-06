import GLib from 'gi://GLib';

/** Ticks once per second while started and hands out the local time. */
export class ClockService {
    constructor(onTick) {
        this._onTick = onTick;
        this._sourceId = 0;
    }

    start() {
        if (this._sourceId)
            return;
        this._onTick(GLib.DateTime.new_now_local());
        this._sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._onTick(GLib.DateTime.new_now_local());
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._sourceId, '[osmin] clock');
    }

    stop() {
        if (!this._sourceId)
            return;
        GLib.source_remove(this._sourceId);
        this._sourceId = 0;
    }

    destroy() {
        this.stop();
    }
}
