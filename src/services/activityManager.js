import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {EventType, Priority} from '../utils/events.js';

/**
 * Keeps track of Live Activities.
 *
 *  - start(activity) / end(id): an activity is ongoing; the highest
 *    `compactPriority` one is shown in the collapsed capsule (`compact`).
 *  - peek(activity, options): shows the activity's peek card for a while,
 *    through the normal event -> card pipeline (so it is queued with the
 *    other cards). It is skipped while the panel is open, since the user is
 *    already looking at Osmin.
 *
 * Signals: 'ongoing-changed' (the set of ongoing activities changed),
 * 'compact-resized' (an ongoing activity's content changed).
 */
export class ActivityManager extends Signals.EventEmitter {
    constructor(events) {
        super();
        this._events = events;
        this._ongoing = new Map();
        this._hosts = [];
    }

    /** @param {{cards: CardManager, isOpen: () => boolean}} host one per capsule (one per monitor) */
    attach(host) {
        this._hosts.push(host);
    }

    detach(host) {
        this._hosts = this._hosts.filter(h => h !== host);
    }

    get ongoing() {
        return [...this._ongoing.values()];
    }

    /**
     * The activity shown in the collapsed capsule, or null: the one a capsule chose by scrolling
     * (`pinnedId`, each capsule has its own choice) while it is still going, else the most important.
     */
    pick(pinnedId = null) {
        if (pinnedId && this._ongoing.has(pinnedId))
            return this._ongoing.get(pinnedId);
        let best = null;
        for (const activity of this._ongoing.values()) {
            if (!best || activity.compactPriority > best.compactPriority)
                best = activity;
        }
        return best;
    }

    /**
     * The id of the next / previous ongoing activity after the one a capsule shows now.
     * @param {number} direction 1 or -1
     * @param {string|null} pinnedId what that capsule has chosen so far
     * @returns {string|null} null when there is nothing to switch to
     */
    next(direction, pinnedId = null) {
        const list = this.ongoing.sort((a, b) => b.compactPriority - a.compactPriority);
        if (list.length < 2)
            return null;
        const index = list.indexOf(this.pick(pinnedId));
        return list[(index + direction + list.length) % list.length].id;
    }

    start(activity) {
        if (this._ongoing.get(activity.id) === activity)
            return;
        this._ongoing.get(activity.id)?.disconnectObject(this);
        this._ongoing.set(activity.id, activity);
        activity.connectObject('changed', () => this.emit('compact-resized'), this);
        this.emit('ongoing-changed');
    }

    end(id) {
        const activity = this._ongoing.get(id);
        if (!activity)
            return;
        activity.disconnectObject(this);
        this._ongoing.delete(id);
        this.emit('ongoing-changed');
    }

    isOngoing(id) {
        return this._ongoing.has(id);
    }

    /**
     * @param {LiveActivity} activity
     * @param {{duration?: number, priority?: string, persistent?: boolean, force?: boolean, target?: object}} [options]
     *   `force` shows the peek even while the panel is open (alarms); `target`: the one capsule
     *   that shows it (all of them by default).
     */
    peek(activity, {duration = 4000, priority = Priority.NORMAL, persistent = false, force = false, target = null} = {}) {
        if (!force && this._hosts.some(host => host.isOpen()))
            return;
        this._events.emit({
            id: `activity:${activity.id}`,
            type: EventType.ACTIVITY,
            title: activity.title || activity.id,
            priority,
            duration,
            persistent,
            data: {activity, target},
        });
    }

    dismissPeek(id) {
        for (const host of this._hosts)
            host.cards.hide(`activity:${id}`);
    }

    destroy() {
        for (const activity of this._ongoing.values())
            activity.disconnectObject(this);
        this._ongoing.clear();
        this._hosts = [];
    }
}
