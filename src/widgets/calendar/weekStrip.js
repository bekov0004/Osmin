import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

/** The current week as a row of weekday / day-number cells; today is highlighted. */
export class WeekStrip extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminWeekStrip'}, this);
    }

    constructor() {
        super({style_class: 'osmin-week'});
        this._key = null;
    }

    /** @param {GLib.DateTime} now */
    update(now) {
        const key = now.format('%Y-%j');
        if (key === this._key)
            return;
        this._key = key;

        this.destroy_all_children();
        // Shell.util_get_week_start(): 0 = Sunday ... 6 = Saturday (locale based).
        const weekStart = Shell.util_get_week_start();
        const offset = (now.get_day_of_week() % 7 - weekStart + 7) % 7;
        const first = now.add_days(-offset);

        for (let i = 0; i < 7; i++) {
            const day = first.add_days(i);
            const isToday = i === offset;
            const cell = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style_class: `osmin-week-day${isToday ? ' osmin-week-today' : ''}`,
            });
            cell.add_child(new St.Label({
                text: day.format('%a').toUpperCase(),
                style_class: 'osmin-week-name',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            cell.add_child(new St.Label({
                text: day.format('%-e'),
                style_class: 'osmin-week-number',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            this.add_child(cell);
        }
    }
}
