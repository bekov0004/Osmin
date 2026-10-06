import GObject from 'gi://GObject';
import St from 'gi://St';

import {formatTime} from 'resource:///org/gnome/shell/misc/dateUtils.js';

/** Large time with the date underneath (follows the 12/24 h system setting). */
export class CalendarClock extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminCalendarClock'}, this);
    }

    constructor() {
        super({
            vertical: true,
            style_class: 'osmin-clock',
        });
        this._time = new St.Label({style_class: 'osmin-clock-time'});
        this._date = new St.Label({style_class: 'osmin-clock-date'});
        this.add_child(this._time);
        this.add_child(this._date);
    }

    /** @param {GLib.DateTime} now */
    update(now) {
        this._time.text = formatTime(now, {timeOnly: true});
        this._date.text = now.format('%A, %-e %B');
    }
}
