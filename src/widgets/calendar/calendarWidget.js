import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {endOfDay, startOfDay} from '../../services/calendarService.js';
import {Priority} from '../../utils/events.js';
import {OsminWidget} from '../widget.js';
import {CalendarActivity, eventTimeText} from './calendarActivity.js';
import {CalendarBigActivity} from './calendarBigActivity.js';
import {PullGesture} from '../../ui/pullGesture.js';
import {createButton} from '../../ui/button.js';

const DAY_MS = 24 * 3600 * 1000;
const DAYS_SHOWN = 7;

const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const local = date => GLib.DateTime.new_local(date.getFullYear(), date.getMonth() + 1,
    date.getDate(), 0, 0, 0);

/**
 * A compact, glanceable calendar: the month, a strip of days around the
 * selected one (today is accented), and the events of that day.
 */
export class CalendarWidget extends OsminWidget {
    static id = 'calendar';
    static title = 'Calendar';
    static iconName = 'x-office-calendar-symbolic';

    constructor(context) {
        super(context);
        this._calendar = context.services.calendar;
        this._activities = context.services.activities;
        this._settings = context.settings;
        this._activity = null;
        this._announced = new Set();
        this._now = new Date();
        this._selected = startOfDay(this._now); // the day whose events are shown
        this._center = this._selected;          // the middle of the strip
        this._ui = context.ui;
        this._big = new CalendarBigActivity({
            calendar: this._calendar,
            getDay: () => this._selected,
            onDismiss: () => this._ui.hideCard(this._big),
        });
    }

    _enlargeNow() {
        this._ui.showCard(this._big, {persistent: true, priority: Priority.HIGH});
    }

    /** Publishes the Live Activity for the next meeting (from 10 minutes before it starts). */
    start() {
        this._activity = new CalendarActivity();
        this._calendar.connectObject('changed', () => this._onEvents(), this);
        this._updateActivityRange();
        this.syncActivity();
    }

    syncActivity() {
        if (!this._activity)
            return;
        if (!this._settings.get('activity-calendar')) {
            this._activities.end('calendar');
            return;
        }
        const now = new Date();
        const next = this._calendar.upcoming(now, 5, 1).find(e => !e.allDay);
        const minutes = next ? Math.ceil((next.start - now) / 60000) : Infinity;
        const started = next && minutes <= 0 && now - next.start < 2 * 60000;

        if (!next || minutes > 10 || (minutes <= 0 && !started)) {
            this._activities.end('calendar');
            return;
        }
        this._activity.setEvent(next, minutes);
        this._activities.start(this._activity);

        const key = `${next.id}:${started ? 'now' : 'soon'}`;
        if (!this._announced.has(key)) {
            this._announced.add(key);
            this._activities.peek(this._activity, {duration: this._settings.get('peek-calendar-seconds') * 1000, priority: Priority.HIGH});
        }
    }

    _updateActivityRange() {
        const now = new Date();
        this._calendar.setRange('activity', startOfDay(now), new Date(now.getTime() + 3 * DAY_MS));
    }

    _onEvents() {
        this.syncActivity();
        this._refresh();
    }

    createView() {
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-widget osmin-calendar',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            track_hover: true,
        });

        const header = new St.BoxLayout({style_class: 'osmin-cal-header'});
        this._month = new St.Button({
            style_class: 'osmin-cal-month',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            can_focus: true,
        });
        this._month.connect('clicked', () => this.showToday());
        header.add_child(this._month);
        for (const [icon, delta] of [['go-previous-symbolic', -DAYS_SHOWN], ['go-next-symbolic', DAYS_SHOWN]]) {
            const button = new St.Button({
                style_class: 'osmin-cal-nav',
                child: new St.Icon({icon_name: icon, style_class: 'osmin-cal-nav-icon'}),
                can_focus: true,
            });
            button.connect('clicked', () => this.shift(delta));
            header.add_child(button);
        }
        // The enlarge button shows on hover; a two-finger swipe down does the same.
        const enlarge = createButton({
            iconName: 'view-fullscreen-symbolic',
            styleClass: 'osmin-mirror-control',
            onClick: () => this._enlargeNow(),
        });
        enlarge.y_align = Clutter.ActorAlign.CENTER;
        enlarge.opacity = 0;
        header.add_child(enlarge);
        root.connect('notify::hover', () =>
            enlarge.ease({opacity: root.hover ? 255 : 0, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD}));
        this._pull = new PullGesture(direction => {
            if (direction === 'down')
                this._enlargeNow();
        });
        root.connect('scroll-event', (_actor, event) =>
            this._pull.handle(event) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE);
        root.add_child(header);

        this._strip = new St.BoxLayout({style_class: 'osmin-cal-strip', x_expand: true});
        root.add_child(this._strip);

        this._agenda = new St.BoxLayout({vertical: true, style_class: 'osmin-cal-agenda', x_expand: true});
        root.add_child(this._agenda);

        return root;
    }

    onViewCreated() {
        this._rebuild();
    }

    destroy() {
        this._calendar.disconnectObject(this);
        this._calendar.clearRange('view');
        // Only the widget that published the activity (the first capsule's) ends it.
        if (this._activity) {
            this._calendar.clearRange('activity');
            this._activities.end('calendar');
        }
        this._activity?.destroy();
        this._big.destroy();
        this._pull?.destroy();
        super.destroy();
    }

    onTick(_now) {
        const now = new Date();
        const dayChanged = !sameDay(now, this._now);
        this._now = now;
        if (dayChanged)
            this._updateActivityRange();
        this.syncActivity();
        if (!this._view)
            return;
        if (dayChanged && sameDay(this._selected, addDays(now, -1)))
            this.showToday();
        else
            this._refresh();
    }

    onPageShown() {
        this._now = new Date();
        this._rebuild();
    }

    /** Moves the strip by `days` (and the selection with it). */
    shift(days) {
        this._center = addDays(this._center, days);
        this._selected = addDays(this._selected, days);
        this._rebuild();
    }

    showToday() {
        this._now = new Date();
        this._selected = startOfDay(this._now);
        this._center = this._selected;
        this._rebuild();
    }

    _rebuild() {
        if (!this._view)
            return;
        const first = addDays(this._center, -Math.floor(DAYS_SHOWN / 2));
        const last = addDays(first, DAYS_SHOWN);
        // Events for the strip, plus the next two weeks for "next up".
        this._calendar.setRange('view', startOfDay(this._now) < first ? startOfDay(this._now) : first,
            new Date(Math.max(last.getTime(), this._now.getTime() + 14 * DAY_MS)));

        this._month.label = local(this._selected).format('%B');

        this._strip.destroy_all_children();
        for (let i = 0; i < DAYS_SHOWN; i++)
            this._strip.add_child(this._createDay(addDays(first, i)));
        this._updateAgenda();
    }

    _refresh() {
        if (this._view)
            this._rebuild();
    }

    _createDay(day) {
        const weekday = day.getDay();
        const classes = ['osmin-cal-day'];
        if (sameDay(day, this._now))
            classes.push('osmin-cal-today');
        if (sameDay(day, this._selected))
            classes.push('osmin-cal-selected');
        if (weekday === 0 || weekday === 6)
            classes.push('osmin-cal-weekend');

        const button = new St.Button({style_class: classes.join(' '), x_expand: true, can_focus: true});
        const box = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER});
        box.add_child(new St.Label({
            text: local(day).format('%a').slice(0, 1).toUpperCase(),
            style_class: 'osmin-cal-weekday',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(new St.Label({
            text: String(day.getDate()).padStart(2, '0'),
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
            this._selected = day;
            this._rebuild();
        });
        return button;
    }

    _updateAgenda() {
        this._agenda.destroy_all_children();
        const selected = this._selected;
        const isToday = sameDay(selected, this._now);
        const events = this._calendar.getEvents(startOfDay(selected), endOfDay(selected));

        if (events.length === 0) {
            const row = new St.BoxLayout({style_class: 'osmin-cal-empty', x_align: Clutter.ActorAlign.CENTER});
            row.add_child(new St.Icon({
                icon_name: 'x-office-calendar-symbolic',
                style_class: 'osmin-cal-empty-icon',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            const label = isToday ? 'Nothing for today'
                : this._calendar.hasCalendars ? `Nothing on ${local(selected).format('%a %-e')}` : 'No calendars set up';
            row.add_child(new St.Label({
                text: label,
                style_class: 'osmin-cal-empty-text',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            this._agenda.add_child(row);
            return;
        }
        for (const event of events.slice(0, 2)) {
            const row = new St.BoxLayout({style_class: 'osmin-cal-event'});
            row.add_child(new St.Label({
                text: eventTimeText(event),
                style_class: 'osmin-cal-event-time',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            const title = new St.Label({
                text: event.summary,
                style_class: 'osmin-cal-event-title',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            row.add_child(title);
            this._agenda.add_child(row);
        }
    }
}
