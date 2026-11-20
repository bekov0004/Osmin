import GLib from 'gi://GLib';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import * as R from '../utils/reminders.js';

const CHECK_S = 5;

/**
 * The butterfly's reminders (utils/reminders.js), stored in the `reminders` setting. Every few seconds it looks for
 * one that is due and emits 'due' (reminder) once for it; 'changed' when the list changed.
 */
export class ReminderService extends Signals.EventEmitter {
    /** @param {SettingsService} settings */
    constructor(settings) {
        super();
        this._settings = settings;
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, CHECK_S, () => {
            this._check();
            return GLib.SOURCE_CONTINUE;
        });
        settings.connectObject('changed', (_s, key) => {
            if (key === 'reminders')
                this.emit('changed');
        }, this);
        // a moment after the start (a reminder missed while the computer slept)
        this._first = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 3, () => {
            this._first = 0;
            this._check();
            return GLib.SOURCE_REMOVE;
        });
    }

    get list() {
        return R.parseList(this._settings.get('reminders'));
    }

    _save(list) {
        this._settings.gsettings?.set_string('reminders', JSON.stringify(list));
    }

    _patch(id, change) {
        this._save(this.list.map(r => (r.id === id ? change(r) : r)));
    }

    /** @returns {object} the new reminder; throws when the time cannot be read */
    add({time, text, repeat}) {
        const reminder = R.newReminder({time, text, repeat});
        this._save([...this.list, reminder]);
        return reminder;
    }

    setEnabled(id, enabled) {
        this._patch(id, r => {
            if (!enabled)
                return {...r, enabled: false, snoozeUntil: 0};
            // a 'once' one switched on again rings at its next time
            return r.repeat === 'once' ? {...R.newReminder(r), id: r.id} : {...r, enabled: true};
        });
    }

    remove(id) {
        this._save(this.list.filter(r => r.id !== id));
    }

    snooze(id, minutes = 10) {
        this._patch(id, r => R.snoozed(r, minutes));
    }

    /** Shows it now (a test from the settings or the panel), without changing it. */
    preview(reminder) {
        this.emit('due', reminder);
    }

    _check() {
        const now = new Date();
        const list = this.list;
        const due = list.filter(r => R.isDue(r, now));
        if (!due.length)
            return;
        this._save(list.map(r => (due.includes(r) ? R.rang(r, now) : r)));
        for (const reminder of due)
            this.emit('due', reminder);
    }

    destroy() {
        if (this._timer)
            GLib.source_remove(this._timer);
        if (this._first)
            GLib.source_remove(this._first);
        this._timer = this._first = 0;
        this._settings.disconnectObject(this);
    }
}
