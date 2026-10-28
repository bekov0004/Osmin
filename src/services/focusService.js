import GLib from 'gi://GLib';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const MINUTE = 60 * 1000;

/**
 * The stopwatch and the focus (Pomodoro) timer as the widget sees them: a mirror of the Osmin
 * service's state (service/focus) with the shown seconds counted locally.
 * Signals: 'changed', 'tick' (a shown second changed), 'phase' ({phase, finished}).
 */
export class FocusService extends Signals.EventEmitter {
    /** @param {ModuleClient} module */
    constructor(module) {
        super();
        this._module = module;
        this._tickId = 0;
        module.connect('state-changed', () => this._onState());
        module.connect('event', (_m, name, payload) => {
            if (name === 'phase')
                this.emit('phase', payload);
        });
    }

    get _stopwatch() {
        return this._module.state.stopwatch ?? {state: 'idle', since: 0, elapsed: 0, laps: []};
    }

    get _pomo() {
        return this._module.state.pomo ?? {state: 'idle', phase: 'work', endAt: 0, remaining: 25 * MINUTE, round: 1, done: 0, config: {work: 25, short: 5, long: 15, every: 4}};
    }

    // --- stopwatch ---

    get stopwatchState() {
        return this._stopwatch.state;
    }

    /** ms */
    get stopwatchElapsed() {
        const s = this._stopwatch;
        return s.elapsed + (s.state === 'running' ? Date.now() - s.since : 0);
    }

    get laps() {
        return this._stopwatch.laps;
    }

    // --- focus timer ---

    get pomoState() {
        return this._pomo.state;
    }

    get phase() {
        return this._pomo.phase;
    }

    get round() {
        return this._pomo.round;
    }

    get config() {
        return this._pomo.config;
    }

    /** ms left in the phase */
    get pomoRemaining() {
        const p = this._pomo;
        return p.state === 'running' ? Math.max(0, p.endAt - Date.now()) : p.remaining;
    }

    get pomoDuration() {
        const c = this._pomo.config;
        const minutes = this._pomo.phase === 'work' ? c.work : this._pomo.phase === 'long' ? c.long : c.short;
        return minutes * MINUTE;
    }

    /** Something is running (so the capsule can show it). */
    get active() {
        return this._stopwatch.state !== 'idle' || this._pomo.state !== 'idle';
    }

    get running() {
        return this._stopwatch.state === 'running' || this._pomo.state === 'running';
    }

    swStart() { this._call('swStart'); }
    swPause() { this._call('swPause'); }
    swLap() { this._call('swLap'); }
    swReset() { this._call('swReset'); }
    pomoStart() { this._call('pomoStart', {config: this.config}); }
    pomoPause() { this._call('pomoPause'); }
    pomoSkip() { this._call('pomoSkip'); }
    pomoReset() { this._call('pomoReset'); }
    pomoConfig(config) { this._call('pomoConfig', {config}); }

    _call(method, args = {}) {
        this._module.call(method, args).catch(e => console.warn(`[osmin] focus: ${e.message}`));
    }

    _onState() {
        if (this.running)
            this._startTicker();
        else
            this._stopTicker();
        this.emit('changed');
    }

    _startTicker() {
        if (this._tickId)
            return;
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this.emit('tick');
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTicker() {
        if (!this._tickId)
            return;
        GLib.source_remove(this._tickId);
        this._tickId = 0;
    }

    destroy() {
        this._stopTicker();
    }
}

/** 4:32 / 1:04:32 */
export function formatClock(ms, {tenths = false} = {}) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    const base = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`;
    return tenths ? `${base}.${Math.floor((ms % 1000) / 100)}` : base;
}
