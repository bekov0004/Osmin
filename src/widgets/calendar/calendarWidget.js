import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {formatTime} from 'resource:///org/gnome/shell/misc/dateUtils.js';

import {endOfDay, startOfDay} from '../../services/calendarService.js';
import {OsminWidget} from '../widget.js';
import {Priority} from '../../utils/events.js';
import {CalendarActivity} from './calendarActivity.js';

const DAY_MS = 24 * 3600 * 1000;

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Month calendar with a dot under days that have events, and a list of the
 * upcoming events (or the events of the day you click).
 */
export class CalendarWidget extends OsminWidget {
    static id = 'calendar';
    static title = 'Calendar';
    static iconName = 'x-office-calendar-symbolic';

    constructor(context) {
        super(context);
        this._calendar = context.services.calendar;
        this._activities = context.services.activities;
        this._activity = null;
        this._announced = new Set();
        this._now = new Date();
        this._month = new Date(this._now.getFullYear(), this._now.getMonth(), 1);
        this._selected = null; // a clicked day, or null for "upcoming"
    }

    /** Publishes the Live Activity for the next meeting (from 10 minutes before it starts). */
    start() {
        this._activity = new CalendarActivity();
        this._calendar.connectObject('changed', () => this._checkUpcoming(), this);
        this._updateActivityRange();
        this._checkUpcoming();
    }

    _updateActivityRange() {
        const now = new Date();
        this._calendar.setRange('activity', startOfDay(now), new Date(now.getTime() + 3 * DAY_MS));
    }

    _checkUpcoming() {
        if (!this._activity)
            return;
        const now = new Date();
        const next = this._calendar.upcoming(now, 5, 1).find(e => !e.allDay);
        const minutes = next ? Math.ceil((next.start - now) / 60000) : Infinity;
        const started = next && minutes <= 0 && now - next.start < 2 * 60000;

        if (!next || (minutes > 10) || (minutes <= 0 && !started)) {
            this._activities.end('calendar');
            return;
        }
        this._activity.setEvent(next, minutes);
        this._activities.start(this._activity);

        const stage = started ? 'now' : 'soon';
        const key = `${next.id}:${stage}`;
        if (!this._announced.has(key)) {
            this._announced.add(key);
            this._activities.peek(this._activity, {duration: 6000, priority: Priority.HIGH});
        }
    }

    createView() {
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-widget osmin-calendar',
            x_expand: true,
            y_expand: true,
        });

        const header = new St.BoxLayout({style_class: 'osmin-cal-header'});
        this._title = new St.Button({
            style_class: 'osmin-cal-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            can_focus: true,
        });
        this._title.connect('clicked', () => this.showToday());
        header.add_child(this._title);
        for (const [icon, delta] of [['go-previous-symbolic', -1], ['go-next-symbolic', 1]]) {
            const button = new St.Button({
                style_class: 'osmin-cal-nav',
                child: new St.Icon({icon_name: icon, style_class: 'osmin-cal-nav-icon'}),
                can_focus: true,
            });
            button.connect('clicked', () => this.shiftMonth(delta));
            header.add_child(button);
        }
        root.add_child(header);

        this._weekdays = new St.BoxLayout({style_class: 'osmin-cal-weekdays', x_expand: true});
        root.add_child(this._weekdays);
        this._grid = new St.BoxLayout({vertical: true, style_class: 'osmin-cal-grid', x_expand: true});
        root.add_child(this._grid);

        this._agenda = new St.BoxLayout({vertical: true, style_class: 'osmin-cal-agenda', x_expand: true});
        root.add_child(this._agenda);

        this._calendar.connectObject('changed', () => this._refresh(), this);
        return root;
    }

    onViewCreated() {
        this._rebuild();
    }

    destroy() {
        this._calendar.disconnectObject(this);
        this._calendar.clearRange('view');
        this._calendar.clearRange('activity');
        this._activities.end('calendar');
        this._activity?.destroy();
        super.destroy();
    }

    onTick(_now) {
        const now = new Date();
        const dayChanged = !sameDay(now, this._now);
        this._now = now;
        if (dayChanged)
            this._updateActivityRange();
        this._checkUpcoming();
        if (!this._view)
            return;
        if (dayChanged && this._selected === null)
            this.showToday();
        else
            this._refresh();
    }

    onPageShown() {
        this._now = new Date();
        this._rebuild();
    }

    shiftMonth(delta) {
        this._month = new Date(this._month.getFullYear(), this._month.getMonth() + delta, 1);
        this._rebuild();
    }

    showToday() {
        this._now = new Date();
        this._month = new Date(this._now.getFullYear(), this._now.getMonth(), 1);
        this._selected = null;
        this._rebuild();
    }

    /** First day shown in the grid (a week boundary on or before the 1st). */
    _gridStart() {
        const first = this._month;
        const weekStart = Shell.util_get_week_start(); // 0 = Sunday
        const offset = (first.getDay() - weekStart + 7) % 7;
        return new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    }

    _rebuild() {
        if (!this._view)
            return;
        const start = this._gridStart();
        const monthEnd = new Date(this._month.getFullYear(), this._month.getMonth() + 1, 0);
        const weeks = Math.ceil(((monthEnd - start) / DAY_MS + 1) / 7);
        const gridEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + weeks * 7);

        // Ask for the visible grid plus the next two weeks (for "upcoming").
        const horizon = new Date(this._now.getTime() + 14 * DAY_MS);
        this._calendar.setRange('view',
            new Date(Math.min(start.getTime(), startOfDay(this._now).getTime())),
            new Date(Math.max(gridEnd.getTime(), horizon.getTime())));

        this._title.label = GLib.DateTime.new_local(this._month.getFullYear(),
            this._month.getMonth() + 1, 1, 0, 0, 0).format('%B %Y');

        this._weekdays.destroy_all_children();
        for (let i = 0; i < 7; i++) {
            const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            this._weekdays.add_child(new St.Label({
                text: GLib.DateTime.new_local(day.getFullYear(), day.getMonth() + 1, day.getDate(), 0, 0, 0)
                    .format('%a').slice(0, 2).toUpperCase(),
                style_class: 'osmin-cal-weekday',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
            }));
        }

        this._grid.destroy_all_children();
        for (let week = 0; week < weeks; week++) {
            const row = new St.BoxLayout({x_expand: true, style_class: 'osmin-cal-row'});
            for (let i = 0; i < 7; i++) {
                const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + i);
                row.add_child(this._createDay(day));
            }
            this._grid.add_child(row);
        }
        this._updateAgenda();
    }

    /** Events changed or the minute passed: update dots and the agenda only. */
    _refresh() {
        if (!this._view)
            return;
        this._rebuild();
    }

    _createDay(day) {
        const classes = ['osmin-cal-day'];
        if (day.getMonth() !== this._month.getMonth())
            classes.push('osmin-cal-other');
        if (sameDay(day, this._now))
            classes.push('osmin-cal-today');
        if (this._selected && sameDay(day, this._selected))
            classes.push('osmin-cal-selected');

        const button = new St.Button({
            style_class: classes.join(' '),
            x_expand: true,
            can_focus: true,
        });
        const box = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER});
        box.add_child(new St.Label({
            text: `${day.getDate()}`,
            style_class: 'osmin-cal-number',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(new St.Widget({
            style_class: 'osmin-cal-event-dot',
            x_align: Clutter.ActorAlign.CENTER,
            opacity: this._calendar.hasEvents(day) ? 255 : 0,
        }));
        button.set_child(box);
        button.connect('clicked', () => {
            this._selected = this._selected && sameDay(this._selected, day) ? null : day;
            this._rebuild();
        });
        return button;
    }

    _updateAgenda() {
        this._agenda.destroy_all_children();
        const selected = this._selected;
        let events;
        let heading;
        if (selected) {
            events = this._calendar.getEvents(startOfDay(selected), endOfDay(selected));
            heading = GLib.DateTime.new_local(selected.getFullYear(), selected.getMonth() + 1,
                selected.getDate(), 0, 0, 0).format('%a %-e %b').toUpperCase();
        } else {
            events = this._calendar.upcoming(this._now, 2);
            heading = 'UPCOMING';
        }

        this._agenda.add_child(new St.Label({text: heading, style_class: 'osmin-cal-heading'}));
        if (events.length === 0) {
            this._agenda.add_child(new St.Label({
                text: this._calendar.hasCalendars ? 'No events' : 'No calendars set up',
                style_class: 'osmin-cal-empty',
            }));
            return;
        }
        for (const event of events.slice(0, 2)) {
            const row = new St.BoxLayout({style_class: 'osmin-cal-event'});
            const title = new St.Label({
                text: event.summary,
                style_class: 'osmin-cal-event-title',
                x_expand: true,
            });
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            row.add_child(title);
            row.add_child(new St.Label({
                text: this._timeText(event),
                style_class: 'osmin-cal-event-time',
            }));
            this._agenda.add_child(row);
        }
    }

    _timeText(event) {
        if (event.allDay)
            return 'All day';
        const date = GLib.DateTime.new_from_unix_local(Math.floor(event.start.getTime() / 1000));
        const time = formatTime(date, {timeOnly: true});
        if (this._selected || sameDay(event.start, this._now))
            return time;
        const tomorrow = new Date(this._now.getFullYear(), this._now.getMonth(), this._now.getDate() + 1);
        if (sameDay(event.start, tomorrow))
            return `Tomorrow ${time}`;
        return `${date.format('%a')} ${time}`;
    }
}
