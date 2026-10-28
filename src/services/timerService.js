import GLib from 'gi://GLib';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

export const TimerState = Object.freeze({
    IDLE: 'idle',
    RUNNING: 'running',
    PAUSED: 'paused',
    DONE: 'done',
});

const TICK_MS = 200;

/**
 * The countdown timer as the widget sees it. The timer itself (the clock, the saved state, the
 * moment it runs out) lives in the Osmin service (service/timer); this mirrors its state and does
 * the counting of the shown seconds locally, from the end time the service reports.
 *
 * Signals: 'changed' (state or settings changed), 'tick' (the displayed second changed),
 * 'finished' ({missed}: it ran out while Osmin was not running).
 */
export class TimerService extends Signals.EventEmitter {
    /** @param {ModuleClient} module */
    constructor(module) {
        super();
        this._module = module;
        this._tickId = 0;
        this._shownSecond = -1;
        module.connect('state-changed', () => this._onState());
        module.connect('event', (_m, name, payload) => {
            if (name === 'finished')
                this.emit('finished', {missed: payload.missed});
        });
    }

    get _s() {
        return this._module.state;
    }

    get state() {
        return this._s.state ?? TimerState.IDLE;
    }

    /** The length the timer was set to (ms). */
    get duration() {
        return this._s.duration ?? 5 * 60 * 1000;
    }

    /** Time left (ms). */
    get remaining() {
        switch (this.state) {
        case TimerState.RUNNING:
            return Math.max(0, (this._s.endAt ?? 0) - Date.now());
        case TimerState.DONE:
            return 0;
        default:
            return this._s.remaining ?? this.duration;
        }
    }

    get active() {
        return this.state !== TimerState.IDLE;
    }

    /** The saved timer arrives from the service by itself. */
    load() {}

    setDuration(ms) {
        this._call('setDuration', {ms});
    }

    start() {
        this._call('start');
    }

    pause() {
        this._call('pause');
    }

    resume() {
        this._call('resume');
    }

    /** Stops the timer and goes back to the set length. */
    reset() {
        this._call('reset');
    }

    /** Adds time to a running / paused / idle timer. */
    addTime(ms) {
        this._call('addTime', {ms});
    }

    destroy() {
        this._stopTicker();
    }

    _call(method, args = {}) {
        this._module.call(method, args).catch(e => console.warn(`[osmin] timer: ${e.message}`));
    }

    _onState() {
        if (this.state === TimerState.RUNNING)
            this._startTicker();
        else
            this._stopTicker();
        if (this._s.missed) {
            // It ran out while nobody was listening: raise the alarm now, once.
            this._module.call('ackMissed').catch(() => {});
            this.emit('finished', {missed: true});
        }
        this.emit('changed');
    }

    _startTicker() {
        this._stopTicker();
        this._shownSecond = Math.ceil(this.remaining / 1000);
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
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
}

/** 4:32 / 1:04:32 */
export function formatRemaining(ms) {
    const total = Math.ceil(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`;
}
