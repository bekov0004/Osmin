import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {formatTime} from 'resource:///org/gnome/shell/misc/dateUtils.js';

import {LiveActivity, createCompactParts} from '../../ui/liveActivity.js';

/** The start time of an event as text ("All day" for all-day events). */
export function eventTimeText(event) {
    if (event.allDay)
        return 'All day';
    return formatTime(GLib.DateTime.new_from_unix_local(Math.floor(event.start.getTime() / 1000)),
        {timeOnly: true});
}

/** A meeting about to start: ongoing from 10 minutes before until shortly after it starts. */
export class CalendarActivity extends LiveActivity {
    constructor() {
        super({id: 'calendar', widgetId: 'calendar', compactPriority: 20});
        this.event = null;
        this.minutes = 0;
    }

    /** @param {object} event calendar event @param {number} minutes until it starts (<= 0: started) */
    setEvent(event, minutes) {
        this.event = event;
        this.minutes = minutes;
        this.notifyChanged();
    }

    get title() {
        return this.event?.summary ?? 'Event';
    }

    get when() {
        return this.minutes > 0 ? `in ${this.minutes} min` : 'Now';
    }

    createCompactParts() {
        return createCompactParts(this, 'x-office-calendar-symbolic', () => this.when);
    }

    createPeekView() {
        const box = new St.BoxLayout({
            style_class: 'osmin-peek',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(new St.Bin({
            style_class: 'osmin-peek-badge',
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'x-office-calendar-symbolic',
                style_class: 'osmin-peek-badge-icon',
            }),
        }));
        const texts = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'osmin-peek-texts',
        });
        const title = new St.Label({style_class: 'osmin-peek-title'});
        const when = new St.Label({style_class: 'osmin-peek-subtitle'});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        texts.add_child(title);
        texts.add_child(when);
        box.add_child(texts);

        const refresh = () => {
            title.text = this.title;
            when.text = this.when;
        };
        this.connectObject('changed', refresh, box);
        box.connect('destroy', () => this.disconnectObject(box));
        refresh();
        return box;
    }
}
