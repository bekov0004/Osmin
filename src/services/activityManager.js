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
        this._cards = null;
        this._isOpen = () => false;
    }

    /** @param {{cards: CardManager, isOpen: () => boolean}} host */
    attach({cards, isOpen}) {
        this._cards = cards;
        this._isOpen = isOpen;
    }

    get ongoing() {
        return [...this._ongoing.values()];
    }

    /** The activity shown in the collapsed capsule, or null. */
    get compact() {
        let best = null;
        for (const activity of this._ongoing.values()) {
            if (!best || activity.compactPriority > best.compactPriority)
                best = activity;
        }
        return best;
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
     * @param {{duration?: number, priority?: string, persistent?: boolean}} [options]
     */
    peek(activity, {duration = 4000, priority = Priority.NORMAL, persistent = false} = {}) {
        if (this._isOpen())
            return;
        this._events.emit({
            id: `activity:${activity.id}`,
            type: EventType.ACTIVITY,
            title: activity.title || activity.id,
            priority,
            duration,
            persistent,
            data: {activity},
        });
    }

    dismissPeek(id) {
        this._cards?.hide(`activity:${id}`);
    }

    destroy() {
        for (const activity of this._ongoing.values())
            activity.disconnectObject(this);
        this._ongoing.clear();
        this._cards = null;
    }
}
