/**
 * Turns the touchpad's events into gestures (pure: the tests feed it plain objects).
 *
 * The events of one gesture: begin, updates, end (or cancel). A swipe is "locked" to a direction once the fingers have
 * moved far enough; then its action is asked for. A live action gets every move from then on (the app switcher follows
 * the fingers); a one-off action happens once, as soon as the fingers have gone far enough, and can be taken back by
 * coming back before that. A pinch happens when the fingers came together (in) or apart (out) far enough; a hold when
 * the fingers rested still and lifted.
 *
 * Event: {type: 'swipe'|'pinch'|'hold', phase: 'begin'|'update'|'end'|'cancel', fingers, dx, dy, scale, time}
 *   dx, dy: the move since the last event, unaccelerated (right and down are positive), scale: of a pinch, from 1
 */
export const LOCK_DISTANCE = 16;          // as GNOME's own gestures
export const TRIGGER_DISTANCE = 90;       // a one-off swipe (at 100 % sensitivity)
export const PINCH_IN = 0.78;
export const PINCH_OUT = 1.3;
export const HOLD_MS = 350;               // shorter is a tap (three fingers tapping are a middle click)

/**
 * @param {object} handlers
 *   resolve(gestureId) -> the action ({id, kind}) given to it
 *   live(gestureId, action, {axis, sign, time}) -> {update(delta, time), end(time, cancelled)} or null
 *   once(gestureId, action, time)
 * @param {() => number} sensitivity  percent: more is a shorter swipe
 */
export class GestureRecognizer {
    constructor(handlers, sensitivity = () => 100) {
        this._handlers = handlers;
        this._sensitivity = sensitivity;
        this._state = null;
    }

    get active() {
        return this._state !== null;
    }

    _factor() {
        return 100 / Math.max(25, Math.min(400, this._sensitivity() || 100));
    }

    /** @returns {boolean} whether the event belongs to a gesture this takes (and so nobody else should have it) */
    handle(event) {
        if (event.phase === 'begin') {
            this._finish(event.time, true);
            if (event.fingers < 3)
                return false;
            this._state = {type: event.type, fingers: event.fingers, start: event.time, cx: 0, cy: 0, session: null, gesture: null, action: null, done: false};
            return true;
        }
        const s = this._state;
        if (!s || s.type !== event.type)
            return false;
        if (event.phase === 'end' || event.phase === 'cancel') {
            this._end(event);
            return true;
        }
        if (s.type === 'swipe')
            this._swipe(event);
        else if (s.type === 'pinch')
            this._pinch(event);
        return true;
    }

    /** Something else took over (the switcher was closed with a key ...): forget the gesture. */
    reset() {
        this._finish(0, true);
    }

    _swipe(event) {
        const s = this._state;
        s.cx += event.dx;
        s.cy += event.dy;
        if (!s.gesture) {
            if (Math.hypot(s.cx, s.cy) < LOCK_DISTANCE)
                return;
            const horizontal = Math.abs(s.cx) > Math.abs(s.cy);
            const direction = horizontal ? (s.cx < 0 ? 'left' : 'right') : (s.cy < 0 ? 'up' : 'down');
            s.axis = horizontal ? 'x' : 'y';
            s.sign = (horizontal ? s.cx : s.cy) < 0 ? -1 : 1;
            s.gesture = `swipe${s.fingers}-${direction}`;
            s.action = this._handlers.resolve(s.gesture);
            if (s.action.kind === 'live') {
                s.session = this._handlers.live(s.gesture, s.action, {axis: s.axis, sign: s.sign, time: event.time});
                // what the fingers already moved counts
                s.session?.update(s.axis === 'x' ? s.cx : s.cy, event.time);
                return;
            }
        }
        if (s.session) {
            s.session.update(s.axis === 'x' ? event.dx : event.dy, event.time);
            return;
        }
        // a one-off action: when the fingers went far enough in the direction of the gesture
        const along = (s.axis === 'x' ? s.cx : s.cy) * s.sign;
        if (!s.done && along >= TRIGGER_DISTANCE * this._factor()) {
            s.done = true;
            if (s.action.id !== 'none')
                this._handlers.once(s.gesture, s.action, event.time);
        }
    }

    _pinch(event) {
        const s = this._state;
        if (s.done || !(event.scale > 0))
            return;
        const k = this._factor();
        let direction = null;
        if (event.scale <= 1 - (1 - PINCH_IN) * k)
            direction = 'in';
        else if (event.scale >= 1 + (PINCH_OUT - 1) * k)
            direction = 'out';
        if (!direction)
            return;
        s.done = true;
        s.gesture = `pinch${s.fingers}-${direction}`;
        const action = this._handlers.resolve(s.gesture);
        if (action.id !== 'none')
            this._handlers.once(s.gesture, action, event.time);
    }

    _end(event) {
        const s = this._state;
        const cancelled = event.phase === 'cancel';
        if (s.type === 'hold' && !cancelled && event.time - s.start >= HOLD_MS) {
            const gesture = `hold${s.fingers}`;
            const action = this._handlers.resolve(gesture);
            if (action.id !== 'none')
                this._handlers.once(gesture, action, event.time);
        }
        this._finish(event.time, cancelled);
    }

    _finish(time, cancelled) {
        const session = this._state?.session;
        this._state = null;
        session?.end(time, cancelled);
    }
}
