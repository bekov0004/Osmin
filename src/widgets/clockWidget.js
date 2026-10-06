import GObject from 'gi://GObject';
import St from 'gi://St';

/** Large time with the date underneath. */
export class ClockWidget extends St.BoxLayout {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            vertical: true,
            style_class: 'osmin-clock',
            x_expand: true,
        });
        this._time = new St.Label({style_class: 'osmin-clock-time'});
        this._date = new St.Label({style_class: 'osmin-clock-date'});
        this.add_child(this._time);
        this.add_child(this._date);
    }

    /** @param {GLib.DateTime} now */
    update(now) {
        this._time.text = now.format('%H:%M');
        this._date.text = now.format('%A, %-e %B');
    }
}
