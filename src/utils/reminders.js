/**
 * The butterfly's reminders, kept as JSON in the `reminders` setting so the quick panel, the capsule and the settings
 * window share them. Plain functions (no GNOME Shell imports): the settings window uses them too.
 *
 * A reminder: {id, time: 'HH:MM', text, repeat: 'once'|'daily'|'weekdays', enabled, date?: 'YYYY-MM-DD' (once: the
 * day it rings), lastFired?: 'YYYY-MM-DD', snoozeUntil?: ms}
 */

export const REPEATS = ['once', 'daily', 'weekdays'];
const LATE_MS = 3 * 3600 * 1000;    // a reminder missed (the computer was asleep) still rings up to 3 hours late

const pad = n => String(n).padStart(2, '0');
export const dayOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function parseTime(text) {
    const match = /^\s*(\d{1,2})[:.\s]?(\d{2})\s*$/.exec(String(text ?? ''));
    if (!match)
        return null;
    const [h, m] = [Number(match[1]), Number(match[2])];
    return h < 24 && m < 60 ? `${pad(h)}:${pad(m)}` : null;
}

export function parseList(json) {
    try {
        const list = JSON.parse(json || '[]');
        return Array.isArray(list) ? list.filter(r => r && parseTime(r.time) && typeof r.text === 'string') : [];
    } catch (e) {
        return [];
    }
}

/** When a reminder rings on a given day, as a Date. */
function at(day, time) {
    const [y, mo, d] = day.split('-').map(Number);
    const [h, m] = time.split(':').map(Number);
    return new Date(y, mo - 1, d, h, m, 0, 0);
}

/** A new reminder: a 'once' one rings today, or tomorrow when that time has passed. */
export function newReminder({time, text, repeat = 'once'}, now = new Date()) {
    time = parseTime(time);
    if (!time)
        throw new Error('Write the time as 18:30');
    const reminder = {id: `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, time, text: String(text ?? '').trim(),
        repeat: REPEATS.includes(repeat) ? repeat : 'once', enabled: true};
    if (reminder.repeat === 'once') {
        const today = dayOf(now);
        reminder.date = at(today, time) > now ? today : dayOf(new Date(now.getTime() + 86400000));
    }
    return reminder;
}

/** The next time it rings (a Date), or null when it will not. */
export function nextRing(reminder, now = new Date()) {
    if (!reminder.enabled)
        return null;
    if (reminder.snoozeUntil)
        return new Date(reminder.snoozeUntil);
    if (reminder.repeat === 'once')
        return reminder.date ? at(reminder.date, reminder.time) : null;
    for (let i = 0; i < 8; i++) {
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
        const key = dayOf(day);
        if (reminder.repeat === 'weekdays' && (day.getDay() === 0 || day.getDay() === 6))
            continue;
        const when = at(key, reminder.time);
        if (reminder.lastFired === key)
            continue;
        if (i === 0 && now - when > LATE_MS)
            continue;
        return when;
    }
    return null;
}

/** Whether it rings now. */
export function isDue(reminder, now = new Date()) {
    const when = nextRing(reminder, now);
    return !!when && when <= now && now - when <= LATE_MS + 60000;
}

/** After it rang: a 'once' one turns off, a repeating one waits for its next day. */
export function rang(reminder, now = new Date()) {
    const next = {...reminder, snoozeUntil: 0};
    if (reminder.repeat === 'once')
        next.enabled = false;
    else
        next.lastFired = dayOf(now);
    return next;
}

/** "Later": it rings again in `minutes`. */
export function snoozed(reminder, minutes = 10, now = new Date()) {
    return {...reminder, enabled: true, snoozeUntil: now.getTime() + minutes * 60000};
}

/** For a list: "Every day", "Weekdays", "Today", "Tomorrow", or the date. */
export function whenText(reminder, now = new Date()) {
    if (reminder.repeat === 'daily')
        return 'Every day';
    if (reminder.repeat === 'weekdays')
        return 'Weekdays';
    if (!reminder.date)
        return '';
    const today = dayOf(now);
    const tomorrow = dayOf(new Date(now.getTime() + 86400000));
    return reminder.date === today ? 'Today' : reminder.date === tomorrow ? 'Tomorrow' : reminder.date;
}

/** The list sorted by the next ring (the ones that will not ring at the end). */
export function sorted(list, now = new Date()) {
    return [...list].sort((a, b) => (nextRing(a, now)?.getTime() ?? Infinity) - (nextRing(b, now)?.getTime() ?? Infinity) || a.time.localeCompare(b.time));
}
