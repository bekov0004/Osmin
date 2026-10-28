import GLib from 'gi://GLib';

import {Module} from '../module.js';
import {JsonStore} from '../lib/jsonStore.js';

const MINUTE = 60 * 1000;
const DEFAULT_CONFIG = {work: 25, short: 5, long: 15, every: 4};

/**
 * A stopwatch with laps and a focus timer (the Pomodoro technique: work, short breaks, a long
 * break every few rounds; each phase starts by itself after the previous one). Both keep wall-clock
 * times, so they survive a restart; saved in ~/.local/share/osmin/focus.json.
 *
 * state: {stopwatch: {state, since, elapsed, laps}, pomo: {state, phase, endAt, remaining, round, done, config}}
 *   stopwatch.since: epoch ms when it last started running; elapsed: ms before that
 *   pomo.endAt: epoch ms the phase ends (while running); remaining: ms (while paused / idle)
 * events: phase {phase, finished}  (a phase ran out; `phase` is the one that begins now)
 */
export class FocusModule extends Module {
    constructor() {
        super('Focus');
        this._store = new JsonStore('focus.json');
        this._sw = {state: 'idle', since: 0, elapsed: 0, laps: []};
        this._pomo = {state: 'idle', phase: 'work', endAt: 0, remaining: DEFAULT_CONFIG.work * MINUTE, round: 1, done: 0, config: {...DEFAULT_CONFIG}};
        this._timer = 0;
    }

    get state() {
        return {stopwatch: this._sw, pomo: this._pomo};
    }

    start() {
        const data = this._store.load();
        if (data?.stopwatch && ['idle', 'running', 'paused'].includes(data.stopwatch.state)) {
            this._sw = {
                state: data.stopwatch.state,
                since: Number(data.stopwatch.since) || 0,
                elapsed: Number(data.stopwatch.elapsed) || 0,
                laps: Array.isArray(data.stopwatch.laps) ? data.stopwatch.laps.map(Number).filter(Number.isFinite).slice(-50) : [],
            };
        }
        if (data?.pomo) {
            const p = data.pomo;
            this._pomo.config = this._cleanConfig(p.config ?? {});
            this._pomo.phase = ['work', 'break', 'long'].includes(p.phase) ? p.phase : 'work';
            this._pomo.round = Math.max(1, Number(p.round) || 1);
            this._pomo.done = Math.max(0, Number(p.done) || 0);
            this._pomo.remaining = Math.max(0, Number(p.remaining) || this._duration(this._pomo.phase));
            this._pomo.endAt = Number(p.endAt) || 0;
            this._pomo.state = ['idle', 'running', 'paused'].includes(p.state) ? p.state : 'idle';
            if (this._pomo.state === 'running') {
                if (this._pomo.endAt <= Date.now())
                    this._resetPomo();   // it ran out while nobody was there
                else
                    this._armTimer();
            }
        }
    }

    stop() {
        this._disarm();
    }

    _cleanConfig(c) {
        const n = (value, fallback, min, max) => Math.min(max, Math.max(min, Math.round(Number(value) || fallback)));
        return {
            work: n(c.work, DEFAULT_CONFIG.work, 1, 180),
            short: n(c.short, DEFAULT_CONFIG.short, 1, 60),
            long: n(c.long, DEFAULT_CONFIG.long, 1, 120),
            every: n(c.every, DEFAULT_CONFIG.every, 2, 10),
        };
    }

    _duration(phase) {
        const c = this._pomo.config;
        return (phase === 'work' ? c.work : phase === 'long' ? c.long : c.short) * MINUTE;
    }

    _save() {
        this._store.save({version: 1, stopwatch: this._sw, pomo: this._pomo});
        this.emitState();
    }

    // --- stopwatch -------------------------------------------------------------

    async rpc_swStart() {
        if (this._sw.state === 'running')
            return;
        this._sw.state = 'running';
        this._sw.since = Date.now();
        this._save();
    }

    async rpc_swPause() {
        if (this._sw.state !== 'running')
            return;
        this._sw.elapsed += Date.now() - this._sw.since;
        this._sw.state = 'paused';
        this._save();
    }

    async rpc_swLap() {
        if (this._sw.state !== 'running')
            return;
        const total = this._sw.elapsed + (Date.now() - this._sw.since);
        this._sw.laps = [...this._sw.laps, total].slice(-50);
        this._save();
    }

    async rpc_swReset() {
        this._sw = {state: 'idle', since: 0, elapsed: 0, laps: []};
        this._save();
    }

    // --- focus timer -----------------------------------------------------------

    async rpc_pomoStart({config = null} = {}) {
        if (config && this._pomo.state === 'idle')
            this._pomo.config = this._cleanConfig(config);
        if (this._pomo.state === 'running')
            return;
        if (this._pomo.state === 'paused') {
            this._pomo.endAt = Date.now() + this._pomo.remaining;
        } else {
            this._pomo.phase = 'work';
            this._pomo.round = 1;
            this._pomo.done = 0;
            this._pomo.remaining = this._duration('work');
            this._pomo.endAt = Date.now() + this._pomo.remaining;
        }
        this._pomo.state = 'running';
        this._armTimer();
        this._save();
    }

    async rpc_pomoPause() {
        if (this._pomo.state !== 'running')
            return;
        this._pomo.remaining = Math.max(0, this._pomo.endAt - Date.now());
        this._pomo.state = 'paused';
        this._disarm();
        this._save();
    }

    /** Ends the phase now: the next one begins. */
    async rpc_pomoSkip() {
        if (this._pomo.state === 'idle')
            return;
        this._advance();
    }

    async rpc_pomoReset() {
        this._disarm();
        this._resetPomo();
        this._save();
    }

    async rpc_pomoConfig({config}) {
        if (this._pomo.state !== 'idle')
            return;
        this._pomo.config = this._cleanConfig(config);
        this._pomo.remaining = this._duration('work');
        this._save();
    }

    _resetPomo() {
        this._pomo.state = 'idle';
        this._pomo.phase = 'work';
        this._pomo.round = 1;
        this._pomo.done = 0;
        this._pomo.endAt = 0;
        this._pomo.remaining = this._duration('work');
    }

    _armTimer() {
        this._disarm();
        const ms = Math.max(50, this._pomo.endAt - Date.now());
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timer = 0;
            this._advance();
            return GLib.SOURCE_REMOVE;
        });
    }

    _disarm() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
    }

    /** The current phase is over (it ran out or was skipped): begin the next one. */
    _advance() {
        const finished = this._pomo.phase;
        let next;
        if (finished === 'work') {
            this._pomo.done++;
            next = this._pomo.done % this._pomo.config.every === 0 ? 'long' : 'break';
        } else {
            next = 'work';
            this._pomo.round = finished === 'long' ? 1 : this._pomo.round + 1;
        }
        this._pomo.phase = next;
        this._pomo.remaining = this._duration(next);
        this._pomo.endAt = Date.now() + this._pomo.remaining;
        this._pomo.state = 'running';
        this._armTimer();
        this._save();
        this.emitEvent('phase', {phase: next, finished});
    }
}
