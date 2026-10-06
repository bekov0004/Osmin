import GObject from 'gi://GObject';
import St from 'gi://St';

import {ClockWidget} from '../clockWidget.js';
import {WeekStrip} from '../weekStrip.js';

/** CENTER section: time, date and the week. Placeholder for a full calendar. */
export class CalendarSection extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminCalendarSection'}, this);
    }

    constructor() {
        super({
            vertical: true,
            x_expand: true,
            style_class: 'osmin-section osmin-calendar-section',
        });
        this._clock = new ClockWidget();
        this._week = new WeekStrip();
        this.add_child(this._clock);
        this.add_child(this._week);
    }

    /** @param {GLib.DateTime} now */
    update(now) {
        this._clock.update(now);
        this._week.update(now);
    }
}
