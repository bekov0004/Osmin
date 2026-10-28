import {Module} from '../module.js';
import {CalendarService} from './calendarService.js';

/**
 * The calendar events of the system calendars (read from the GNOME calendar service).
 * state: {hasCalendars, events: [{id, summary, start, end, allDay}]} (times in ms) for the window
 * the clients asked for. Each client names its ranges ("owner"); the union is requested.
 */
export class CalendarModule extends Module {
    constructor() {
        super('Calendar');
        this._calendar = new CalendarService();
        this._calendar.connect('changed', () => this.emitState());
    }

    get state() {
        const events = this._calendar.getEvents(new Date(0), new Date(8640000000000000));
        return {
            hasCalendars: this._calendar.hasCalendars,
            events: events.map(e => ({id: e.id, summary: e.summary, start: e.start.getTime(), end: e.end.getTime(), allDay: e.allDay})),
        };
    }

    start() {
        this._calendar.start().catch(e => console.warn(`[osmin-service] calendar failed: ${e.message}`));
    }

    stop() {
        this._calendar.destroy();
    }

    async rpc_setRange({owner, begin, end}) {
        this._calendar.setRange(String(owner), new Date(begin), new Date(end));
    }

    async rpc_clearRange({owner}) {
        this._calendar.clearRange(String(owner));
    }
}
