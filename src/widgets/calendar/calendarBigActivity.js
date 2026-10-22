import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {endOfDay, startOfDay} from '../../services/calendarService.js';
import {createButton} from '../../ui/button.js';
import {LiveActivity} from '../../ui/liveActivity.js';
import {PullGesture} from '../../ui/pullGesture.js';
import {scaled} from '../../utils/scale.js';
import {eventTimeText} from './calendarActivity.js';

const WEEKS = 6;
const HEIGHT = 320; // css px, like the enlarged mirror

const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const local = date => GLib.DateTime.new_local(date.getFullYear(), date.getMonth() + 1,
    date.getDate(), 0, 0, 0);

/**
 * The enlarged calendar: a card as wide as the music card, but taller, with a month grid and
 * the events of the chosen day. Shown (persistent) from the Calendar widget's enlarge button
 * or a two-finger swipe down, and goes away with its shrink button or a swipe up.
 * It is never "ongoing": it has no compact face.
 */
export class CalendarBigActivity extends LiveActivity {
    constructor({calendar, getDay, onDismiss}) {
        super({id: 'calendar-big', widgetId: 'calendar'});
        this._calendar = calendar;
        this._getDay = getDay;
        this._onDismiss = onDismiss;
    }

    get title() {
        return 'Calendar';
    }

    get peekSize() {
        return {width: 330, height: HEIGHT};
    }

    createCompactParts() {
        throw new Error('The enlarged calendar has no compact face');
    }

    createPeekView() {
        const today = () => startOfDay(new Date());
        let selected = startOfDay(this._getDay());
        let month = new Date(selected.getFullYear(), selected.getMonth(), 1);

        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-cal-big',
            x_expand: true,
            y_expand: true,
            reactive: true,
        });

        const header = new St.BoxLayout({style_class: 'osmin-cal-header'});
        const title = new St.Button({
            style_class: 'osmin-cal-month',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            can_focus: true,
        });
        title.connect('clicked', () => {
            selected = today();
            month = new Date(selected.getFullYear(), selected.getMonth(), 1);
            rebuild();
        });
        header.add_child(title);
        for (const [icon, delta] of [['go-previous-symbolic', -1], ['go-next-symbolic', 1]]) {
            const button = new St.Button({
                style_class: 'osmin-cal-nav',
                child: new St.Icon({icon_name: icon, style_class: 'osmin-cal-nav-icon'}),
                can_focus: true,
            });
            button.connect('clicked', () => {
                month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
                rebuild();
            });
            header.add_child(button);
        }
        const shrink = createButton({
            iconName: 'view-restore-symbolic',
            styleClass: 'osmin-mirror-control',
            onClick: () => this._onDismiss(),
        });
        shrink.y_align = Clutter.ActorAlign.CENTER;
        shrink.style = `margin-left: ${scaled(6)}px;`;
        header.add_child(shrink);
        root.add_child(header);

        const weekdays = new St.BoxLayout({x_expand: true});
        weekdays.layout_manager.homogeneous = true;
        const monday = addDays(month, 1 - (month.getDay() || 7));
        for (let i = 0; i < 7; i++) {
            weekdays.add_child(new St.Label({
                text: local(addDays(monday, i)).format('%a').slice(0, 2),
                style_class: 'osmin-cal-weekday osmin-cal-big-weekday',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
            }));
        }
        root.add_child(weekdays);

        const grid = new St.BoxLayout({vertical: true, x_expand: true});
        root.add_child(grid);

        root.add_child(new St.Widget({style_class: 'osmin-cal-big-sep'}));

        const agenda = new St.BoxLayout({vertical: true, style_class: 'osmin-cal-agenda', x_expand: true});
        const scroll = new St.ScrollView({
            style_class: 'osmin-cal-big-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        scroll.add_child(agenda);
        root.add_child(scroll);

        const rebuild = () => {
            const first = addDays(month, 1 - (month.getDay() || 7));
            const last = addDays(first, WEEKS * 7);
            this._calendar.setRange('view-big', first, last);
            title.label = local(month).format('%B %Y');

            grid.destroy_all_children();
            for (let w = 0; w < WEEKS; w++) {
                const row = new St.BoxLayout({x_expand: true});
                row.layout_manager.homogeneous = true;
                for (let d = 0; d < 7; d++)
                    row.add_child(createDay(addDays(first, w * 7 + d)));
                grid.add_child(row);
            }

            agenda.destroy_all_children();
            const events = this._calendar.getEvents(startOfDay(selected), endOfDay(selected));
            if (events.length === 0) {
                agenda.add_child(new St.Label({
                    text: this._calendar.hasCalendars ? 'Nothing on this day' : 'No calendars set up',
                    style_class: 'osmin-cal-empty-text',
                }));
            }
            for (const event of events) {
                const line = new St.BoxLayout({style_class: 'osmin-cal-event'});
                line.add_child(new St.Label({
                    text: eventTimeText(event),
                    style_class: 'osmin-cal-event-time',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
                const name = new St.Label({
                    text: event.summary,
                    style_class: 'osmin-cal-event-title',
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                line.add_child(name);
                agenda.add_child(line);
            }
        };

        const createDay = day => {
            const classes = ['osmin-cal-day', 'osmin-cal-big-day'];
            if (day.getMonth() !== month.getMonth())
                classes.push('osmin-cal-big-other');
            if (sameDay(day, new Date()))
                classes.push('osmin-cal-today');
            if (sameDay(day, selected))
                classes.push('osmin-cal-selected');
            if (day.getDay() === 0 || day.getDay() === 6)
                classes.push('osmin-cal-weekend');
            const button = new St.Button({style_class: classes.join(' '), x_expand: true, can_focus: true});
            const box = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER});
            box.add_child(new St.Label({
                text: String(day.getDate()),
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
                selected = day;
                month = new Date(day.getFullYear(), day.getMonth(), 1);
                rebuild();
            });
            return button;
        };

        // Two fingers up shrink the card back.
        const pull = new PullGesture(direction => {
            if (direction === 'up')
                this._onDismiss();
        });
        root.connect('scroll-event', (_actor, event) =>
            pull.handle(event) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE);

        this._calendar.connectObject('changed', rebuild, root);
        root.connect('destroy', () => {
            pull.destroy();
            this._calendar.disconnectObject(root);
            this._calendar.clearRange('view-big');
        });
        rebuild();
        return root;
    }
}
