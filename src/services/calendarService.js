import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const DAY_MS = 24 * 3600 * 1000;

export const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
export const endOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

/**
 * Calendar events of the system calendars, as the widgets see them. The Osmin service
 * (service/calendar) reads them from the GNOME calendar service; this mirrors the events of the
 * window the widgets asked for. Nothing is stored or sent anywhere.
 *
 * Every user registers its own range under a name (setRange) and the union is requested.
 * Signal: 'changed'.
 */
export class CalendarService extends Signals.EventEmitter {
    /** @param {ModuleClient} module */
    constructor(module) {
        super();
        this._module = module;
        this._ranges = new Map();
        this._events = [];
        module.connect('state-changed', () => this._onState());
        // A service that was restarted knows no ranges.
        module.connect('connected', () => this._sendRanges());
    }

    get hasCalendars() {
        return !!this._module.state.hasCalendars;
    }

    /** The events arrive from the service by itself. */
    async start() {}

    setRange(owner, begin, end) {
        this._ranges.set(owner, [begin, end]);
        this._module.call('setRange', {owner, begin: begin.getTime(), end: end.getTime()})
            .catch(e => console.warn(`[osmin] calendar: ${e.message}`));
    }

    clearRange(owner) {
        this._ranges.delete(owner);
        this._module.call('clearRange', {owner}).catch(() => {});
    }

    _sendRanges() {
        for (const [owner, [begin, end]] of this._ranges)
            this._module.call('setRange', {owner, begin: begin.getTime(), end: end.getTime()}).catch(() => {});
    }

    _onState() {
        this._events = (this._module.state.events ?? []).map(e => ({
            id: e.id,
            summary: e.summary,
            start: new Date(e.start),
            end: new Date(e.end),
            allDay: e.allDay,
        }));
        this.emit('changed');
    }

    /** Events overlapping [begin, end), sorted by start. */
    getEvents(begin, end) {
        return this._events
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
        this._events = [];
    }
}
