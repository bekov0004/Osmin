import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';
import {loadInterfaceXML} from 'resource:///org/gnome/shell/misc/fileUtils.js';

const IFACE = Gio.DBusInterfaceInfo.new_for_xml(loadInterfaceXML('org.gnome.Shell.CalendarServer'));

const DAY_MS = 24 * 3600 * 1000;

export const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
export const endOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

/**
 * Calendar events of the system calendars (GNOME Online Accounts, Evolution
 * data server, ...), read from the same session service the GNOME calendar
 * uses: org.gnome.Shell.CalendarServer. Nothing is stored or sent anywhere.
 *
 * The service tracks one time window; setRange() picks it. Signal: 'changed'.
 */
export class CalendarService extends Signals.EventEmitter {
    constructor() {
        super();
        this._proxy = null;
        this._events = new Map();
        this._ranges = new Map();
        this._begin = null;
        this._end = null;
        this._cancellable = new Gio.Cancellable();
    }

    get hasCalendars() {
        return this._proxy?.g_name_owner ? !!this._proxy.HasCalendars : false;
    }

    async start() {
        this._proxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_interface_name: IFACE.name,
            g_interface_info: IFACE,
            g_name: 'org.gnome.Shell.CalendarServer',
            g_object_path: '/org/gnome/Shell/CalendarServer',
        });
        try {
            await this._proxy.init_async(GLib.PRIORITY_DEFAULT, this._cancellable);
        } catch (e) {
            // A timeout is fine: the service may appear later.
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            if (!e.matches(Gio.DBusError, Gio.DBusError.TIMED_OUT)) {
                console.warn(`[osmin] calendar service unavailable: ${e.message}`);
                return;
            }
        }
        this._proxy.connectSignal('EventsAddedOrUpdated', (_p, _sender, args) => this._onAdded(args[0] ?? []));
        this._proxy.connectSignal('EventsRemoved', (_p, _sender, args) => this._onRemoved(args[0] ?? []));
        this._proxy.connectSignal('ClientDisappeared', (_p, _sender, args) => this._removeMatching(`${args[0] ?? ''}\n`));
        this._proxy.connect('notify::g-name-owner', () => {
            this._events.clear();
            this._requestRange(true);
            this.emit('changed');
        });
        this._proxy.connect('g-properties-changed', () => this.emit('changed'));
        this._requestRange(true);
    }

    /**
     * Asks the service for the events between two dates (Date objects). The
     * service tracks one window, so every user of this service registers its
     * own range under a name and the union is requested.
     */
    setRange(owner, begin, end) {
        this._ranges.set(owner, [begin, end]);
        this._updateWindow();
    }

    clearRange(owner) {
        this._ranges.delete(owner);
        this._updateWindow();
    }

    /** Events overlapping [begin, end), sorted by start. */
    getEvents(begin, end) {
        return [...this._events.values()]
            .filter(e => e.end > begin && e.start < end || (e.start >= begin && e.start < end))
            .sort((a, b) => a.start - b.start);
    }

    hasEvents(day) {
        return this.getEvents(startOfDay(day), endOfDay(day)).length > 0;
    }

    /** The next events that have not ended yet, within `days` days. */
    upcoming(now, limit = 3, days = 14) {
        return this.getEvents(now, new Date(now.getTime() + days * DAY_MS))
            .filter(e => e.end > now)
            .slice(0, limit);
    }

    destroy() {
        this._cancellable.cancel();
        this._proxy?.run_dispose();
        this._proxy = null;
        this._events.clear();
    }

    _updateWindow() {
        const ranges = [...this._ranges.values()];
        if (ranges.length === 0)
            return;
        const begin = new Date(Math.min(...ranges.map(r => r[0].getTime())));
        const end = new Date(Math.max(...ranges.map(r => r[1].getTime())));
        if (this._begin?.getTime() === begin.getTime() && this._end?.getTime() === end.getTime())
            return;
        this._begin = begin;
        this._end = end;
        this._requestRange(true);
    }

    _requestRange(force) {
        if (!this._proxy?.g_name_owner || !this._begin || !this._end)
            return;
        this._proxy.SetTimeRangeAsync(this._begin.getTime() / 1000, this._end.getTime() / 1000,
            force, Gio.DBusCallFlags.NONE).catch(e => console.warn(`[osmin] calendar range failed: ${e.message}`));
    }

    _onAdded(appointments) {
        const handled = new Set();
        for (const [id, summary, startTime, endTime] of appointments) {
            // A recurring event: drop its previous instances first.
            if (!id.endsWith('\n')) {
                const parent = id.substring(0, id.lastIndexOf('\n') + 1);
                if (!handled.has(parent)) {
                    handled.add(parent);
                    this._removeMatching(parent, {emit: false});
                }
            }
            const start = new Date(startTime * 1000);
            const end = new Date(endTime * 1000);
            this._events.set(id, {id, summary, start, end, allDay: this._isAllDay(start, end)});
        }
        if (appointments.length > 0)
            this.emit('changed');
    }

    _onRemoved(ids) {
        let changed = false;
        for (const id of ids)
            changed = this._removeMatching(id, {emit: false}) || changed;
        if (changed)
            this.emit('changed');
    }

    _removeMatching(prefix, {emit = true} = {}) {
        let changed = false;
        for (const id of [...this._events.keys()]) {
            if (id.startsWith(prefix))
                changed = this._events.delete(id) || changed;
        }
        if (changed && emit)
            this.emit('changed');
        return changed;
    }

    _isAllDay(start, end) {
        const midnight = d => d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
        return midnight(start) && midnight(end) && end - start >= DAY_MS - 3600 * 1000;
    }
}
