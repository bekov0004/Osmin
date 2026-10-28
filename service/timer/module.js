import {Module} from '../module.js';
import {TimerService} from './timerService.js';

/**
 * The countdown timer. state: {state, duration, remaining, endAt, missed}
 * (`endAt` is the wall-clock end in ms while it runs, `remaining` is for idle / paused / done;
 * `missed`: it ran out while nobody was listening: the extension shows the alarm and acknowledges).
 * events: finished {missed}
 */
export class TimerModule extends Module {
    constructor() {
        super('Timer');
        this._timer = new TimerService();
        this._missed = false;
        this._timer.connect('changed', () => this.emitState());
        this._timer.connect('finished', (_t, {missed}) => {
            if (missed)
                this._missed = true;
            else
                this.emitEvent('finished', {missed: false});
        });
    }

    get state() {
        const t = this._timer;
        return {state: t.state, duration: t.duration, remaining: t.remaining, endAt: t._endAt, missed: this._missed};
    }

    start() {
        this._timer.load();
    }

    stop() {
        this._timer.destroy();
    }

    async rpc_setDuration({ms}) {
        this._timer.setDuration(ms);
    }

    async rpc_start() {
        this._timer.start();
    }

    async rpc_pause() {
        this._timer.pause();
    }

    async rpc_resume() {
        this._timer.resume();
    }

    async rpc_reset() {
        this._timer.reset();
    }

    async rpc_addTime({ms}) {
        this._timer.addTime(ms);
    }

    async rpc_ackMissed() {
        this._missed = false;
        this.emitState();
    }
}
