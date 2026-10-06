import {Priority, normalizeEvent, priorityRank} from '../utils/events.js';
import {Timers} from '../utils/timers.js';

export const CardPhase = Object.freeze({
    HIDDEN: 'hidden',
    OPENING: 'opening',
    VISIBLE: 'visible',
    UPDATING: 'updating',
    CLOSING: 'closing',
});

const MAX_QUEUE = 32;

/**
 * Decides which card is on screen and what waits. It owns no widgets: it
 * drives a `host` (the Osmin window) that renders and animates, and reports
 * back through callbacks:
 *
 *   host.showCard(card, onShown)    fade a new card in, then call onShown
 *   host.updateCard(card, onDone)   swap the content of the current card
 *   host.hideCard(card, onHidden)   fade the current card out
 *   host.setPending(count)          number of cards waiting in the queue
 *   host.idle()                     nothing left to show
 *
 * Rules:
 *  - one card at a time; the rest wait in a queue ordered by priority
 *    (critical > high > normal > low), first-in-first-out within a priority;
 *  - a card of strictly higher priority preempts the visible one, which goes
 *    back to the front of its priority group;
 *  - a card with the id of a visible/queued card updates it in place;
 *  - non-persistent cards hide after `duration`; the timer is paused while
 *    the pointer is over the island (pause()/resume()).
 */
export class CardManager {
    constructor(host) {
        this._host = host;
        this._timers = new Timers();
        this._queue = [];
        this._current = null; // {card, phase}
        this._paused = false;
    }

    get pending() {
        return this._queue.length;
    }

    get currentCard() {
        return this._current?.card ?? null;
    }

    get currentPhase() {
        return this._current?.phase ?? CardPhase.HIDDEN;
    }

    /** Shows `raw` now, or queues it behind the visible card. */
    show(raw) {
        const card = normalizeEvent(raw);
        if (!card)
            return false;

        const current = this._current;
        if (current?.card.id === card.id && current.phase !== CardPhase.CLOSING) {
            this._updateCurrent(card);
            return true;
        }

        const queued = this._queue.findIndex(c => c.id === card.id);
        if (queued >= 0) {
            this._queue.splice(queued, 1);
            this._enqueue(card);
            return true;
        }

        if (!current) {
            this._present(card);
        } else if (current.phase !== CardPhase.CLOSING &&
                   priorityRank(card.priority) > priorityRank(current.card.priority)) {
            this._enqueue(current.card, {front: true});
            this._enqueue(card);
            this._closeCurrent();
        } else {
            this._enqueue(card);
        }
        return true;
    }

    /** Patches the visible or queued card with this id. */
    update(id, patch) {
        const current = this._current;
        if (current?.card.id === id && current.phase !== CardPhase.CLOSING) {
            const card = this._merge(current.card, patch);
            if (!card)
                return false;
            this._updateCurrent(card);
            return true;
        }

        const index = this._queue.findIndex(c => c.id === id);
        if (index < 0)
            return false;
        const card = this._merge(this._queue[index], patch);
        if (!card)
            return false;
        this._queue.splice(index, 1);
        this._enqueue(card);
        return true;
    }

    /** Swaps the card with this id for a different one, in the same place. */
    replace(id, raw) {
        const card = normalizeEvent(raw);
        if (!card)
            return false;
        if (card.id === id)
            return this.update(id, card);

        const current = this._current;
        if (current?.card.id === id && current.phase !== CardPhase.CLOSING) {
            this._queue.unshift(card);
            this._closeCurrent();
            return true;
        }

        const index = this._queue.findIndex(c => c.id === id);
        if (index < 0)
            return this.show(card);
        this._queue[index] = card;
        return true;
    }

    /** Hides the visible card with this id, or drops it from the queue. */
    hide(id) {
        if (this._current?.card.id === id) {
            this._closeCurrent();
            return true;
        }
        const index = this._queue.findIndex(c => c.id === id);
        if (index < 0)
            return false;
        this._queue.splice(index, 1);
        this._host.setPending(this._queue.length);
        return true;
    }

    hideCurrent() {
        this._closeCurrent();
    }

    /** Drops everything that is queued and hides the visible card. */
    clear() {
        this._queue = [];
        this._host.setPending(0);
        this._closeCurrent();
    }

    /** Stops the auto-hide timer (pointer is over the island). */
    pause() {
        this._paused = true;
        this._timers.clear('hide');
    }

    resume() {
        this._paused = false;
        this._armTimer();
    }

    /** Releases timers without touching the host (it is being destroyed too). */
    destroy() {
        this._timers.destroy();
        this._queue = [];
        this._current = null;
    }

    _present(card) {
        const entry = {card, phase: CardPhase.OPENING};
        this._current = entry;
        this._host.setPending(this._queue.length);
        this._host.showCard(card, () => {
            if (this._current !== entry || entry.phase !== CardPhase.OPENING)
                return;
            entry.phase = CardPhase.VISIBLE;
            this._armTimer();
        });
    }

    _updateCurrent(card) {
        const entry = this._current;
        entry.card = card;
        entry.phase = CardPhase.UPDATING;
        this._timers.clear('hide');
        this._host.updateCard(card, () => {
            if (this._current !== entry || entry.phase !== CardPhase.UPDATING)
                return;
            entry.phase = CardPhase.VISIBLE;
            this._armTimer();
        });
    }

    _closeCurrent() {
        const entry = this._current;
        if (!entry || entry.phase === CardPhase.CLOSING)
            return;
        entry.phase = CardPhase.CLOSING;
        this._timers.clear('hide');
        this._host.hideCard(entry.card, () => {
            if (this._current !== entry)
                return;
            entry.phase = CardPhase.HIDDEN;
            this._current = null;
            this._next();
        });
    }

    _next() {
        const card = this._queue.shift();
        if (card) {
            this._present(card);
        } else {
            this._host.setPending(0);
            this._host.idle();
        }
    }

    _armTimer() {
        const entry = this._current;
        if (!entry || entry.phase !== CardPhase.VISIBLE || this._paused)
            return;
        if (entry.card.duration <= 0)
            return;
        this._timers.set('hide', entry.card.duration, () => {
            if (this._current === entry)
                this._closeCurrent();
        });
    }

    /** Inserts by priority; `front` puts it ahead of equal-priority cards. */
    _enqueue(card, {front = false} = {}) {
        const rank = priorityRank(card.priority);
        let index = this._queue.findIndex(c => front
            ? priorityRank(c.priority) <= rank
            : priorityRank(c.priority) < rank);
        if (index < 0)
            index = this._queue.length;
        this._queue.splice(index, 0, card);

        if (this._queue.length > MAX_QUEUE) {
            // Drop the oldest card of the lowest priority.
            const lowest = Math.min(...this._queue.map(c => priorityRank(c.priority)));
            this._queue.splice(this._queue.findIndex(c => priorityRank(c.priority) === lowest), 1);
        }
        this._host.setPending(this._queue.length);
    }

    _merge(card, patch) {
        const raw = {...card, ...patch, id: card.id};
        if ('priority' in patch) {
            if (!('duration' in patch))
                delete raw.duration;
            if (!('persistent' in patch) && card.priority === Priority.CRITICAL)
                raw.persistent = false;
        }
        return normalizeEvent(raw);
    }
}
