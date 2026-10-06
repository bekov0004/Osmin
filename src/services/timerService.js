import GLib from 'gi://GLib';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {JsonStore} from '../utils/jsonStore.js';

export const TimerState = Object.freeze({
    IDLE: 'idle',
    RUNNING: 'running',
    PAUSED: 'paused',
    DONE: 'done',
});

const MIN_MS = 1000;
const MAX_MS = 99 * 3600 * 1000;
const DEFAULT_MS = 5 * 60 * 1000;
const TICK_MS = 200;

/**
 * A countdown timer. It keeps an absolute end time (wall clock), so it
 * survives suspend and a shell restart: the state is saved to
 * ~/.local/share/osmin/timer.json.
 *
 * Signals: 'changed' (state or settings changed), 'tick' (the displayed
 * second changed), 'finished' ({missed}: it ran out while Osmin was not running).
 */
export class TimerService extends Signals.EventEmitter {
    constructor() {
        super();
        this._state = TimerState.IDLE;
        this._duration = DEFAULT_MS;
        this._remaining = DEFAULT_MS; // while idle / paused
        this._endAt = 0;              // epoch ms, while running
        this._tickId = 0;
        this._shownSecond = -1;
        this._store = new JsonStore('timer.json');
    }

    get state() {
        return this._state;
    }

    /** The length the timer was set to (ms). */
    get duration() {
        return this._duration;
    }

    /** Time left (ms). */
    get remaining() {
        if (this._state === TimerState.RUNNING)
            return Math.max(0, this._endAt - Date.now());
        if (this._state === TimerState.DONE)
            return 0;
        return this._remaining;
    }

    get active() {
        return this._state !== TimerState.IDLE;
    }

    load() {
        const data = this._store.load();
        if (data) {
            this._duration = this._clamp(Number(data.duration) || DEFAULT_MS);
            this._remaining = this._clamp(Number(data.remaining) || this._duration);
            this._endAt = Number(data.endAt) || 0;
            this._state = Object.values(TimerState).includes(data.state) ? data.state : TimerState.IDLE;
            if (this._state === TimerState.RUNNING) {
                if (this._endAt <= Date.now())
                    this._finish({missed: true});
                else
                    this._startTicker();
            }
        }
        this.emit('changed');
    }

    /** Sets the length (only while idle). */
    setDuration(ms) {
        if (this._state !== TimerState.IDLE)
            return;
        this._duration = this._remaining = this._clamp(ms);
        this._changed();
    }

    start() {
        if (this._state === TimerState.RUNNING)
            return;
        if (this._state === TimerState.PAUSED) {
            this.resume();
            return;
        }
        this._remaining = this._duration;
        this._endAt = Date.now() + this._remaining;
        this._state = TimerState.RUNNING;
        this._startTicker();
        this._changed();
    }

    pause() {
        if (this._state !== TimerState.RUNNING)
            return;
        this._remaining = this.remaining;
        this._state = TimerState.PAUSED;
        this._stopTicker();
        this._changed();
    }

    resume() {
        if (this._state !== TimerState.PAUSED)
            return;
        this._endAt = Date.now() + this._remaining;
        this._state = TimerState.RUNNING;
        this._startTicker();
        this._changed();
    }

    /** Stops the timer and goes back to the set length. */
    reset() {
        this._stopTicker();
        this._state = TimerState.IDLE;
        this._remaining = this._duration;
        this._changed();
    }

    /** Adds time to a running / paused / idle timer. */
    addTime(ms) {
        switch (this._state) {
        case TimerState.RUNNING:
            this._endAt += ms;
            break;
        case TimerState.PAUSED:
            this._remaining = this._clamp(this._remaining + ms);
            break;
        case TimerState.DONE:
            // "+1 min" on a finished timer starts a new short countdown.
            this._remaining = this._clamp(ms);
            this._endAt = Date.now() + this._remaining;
            this._state = TimerState.RUNNING;
            this._startTicker();
            break;
        default:
            this._duration = this._remaining = this._clamp(this._duration + ms);
        }
        this._changed();
    }

    destroy() {
        this._stopTicker();
    }

    _clamp(ms) {
        return Math.min(Math.max(Math.round(ms / 1000) * 1000, MIN_MS), MAX_MS);
    }

    _startTicker() {
        this._stopTicker();
        this._shownSecond = Math.ceil(this.remaining / 1000);
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
            if (this.remaining <= 0) {
                this._tickId = 0;
                this._finish({missed: false});
                return GLib.SOURCE_REMOVE;
            }
            const second = Math.ceil(this.remaining / 1000);
            if (second !== this._shownSecond) {
                this._shownSecond = second;
                this.emit('tick');
            }
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._tickId, '[osmin] timer');
    }

    _stopTicker() {
        if (!this._tickId)
            return;
        GLib.source_remove(this._tickId);
        this._tickId = 0;
    }

    _finish({missed}) {
        this._stopTicker();
        this._state = TimerState.DONE;
        this._remaining = 0;
        this._save();
        this.emit('changed');
        this.emit('finished', {missed});
    }

    _changed() {
        this._save();
        this.emit('changed');
    }

    _save() {
        this._store.save({
            version: 1,
            state: this._state,
            duration: this._duration,
            remaining: this._remaining,
            endAt: this._endAt,
        });
    }
}

/** 4:32 / 1:04:32 */
export function formatRemaining(ms) {
    const total = Math.ceil(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`;
}
