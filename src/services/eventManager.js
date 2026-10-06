import {normalizeEvent} from '../utils/events.js';

/**
 * The entry point for everything that wants to show something in Osmin.
 * Sources call emit(); consumers (the CardManager) subscribe(). It knows
 * nothing about cards, queues or widgets.
 *
 *   eventManager.emit({type: 'notification', title: 'Done', message: 'file.zip'});
 */
export class EventManager {
    constructor() {
        this._subscribers = new Set();
    }

    /** @returns {object|null} the normalized event, or null if it was rejected */
    emit(raw) {
        const event = normalizeEvent(raw);
        if (!event) {
            console.warn('[osmin] ignoring event without a title or description');
            return null;
        }

        // Copy so handlers may unsubscribe while we iterate.
        for (const subscriber of [...this._subscribers]) {
            if (subscriber.types && !subscriber.types.has(event.type))
                continue;
            try {
                subscriber.handler(event);
            } catch (e) {
                console.error(`[osmin] event handler failed: ${e}\n${e.stack}`);
            }
        }
        return event;
    }

    /**
     * @param {(event: object) => void} handler
     * @param {{types?: string[]}} [options] only receive these event types
     * @returns {() => void} unsubscribe function
     */
    subscribe(handler, {types} = {}) {
        const subscriber = {handler, types: types ? new Set(types) : null};
        this._subscribers.add(subscriber);
        return () => this._subscribers.delete(subscriber);
    }

    destroy() {
        this._subscribers.clear();
    }
}
