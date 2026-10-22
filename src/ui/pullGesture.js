import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const THRESHOLD = 1.2;     // touchpad scroll units of a deliberate two-finger swipe
const GAP_MS = 250;        // a pause that starts a new swipe
const LOCK_MS = 700;       // after it fires, the rest of the swipe (inertia) is ignored

/**
 * Recognises a two-finger touchpad swipe down or up over an actor. Fingers
 * "down" mean down regardless of the natural-scrolling setting.
 */
export class PullGesture {
    /** @param {(direction: 'down'|'up') => void} onPull */
    constructor(onPull) {
        this._onPull = onPull;
        try {
            this._touchpad = new Gio.Settings({schema_id: 'org.gnome.desktop.peripherals.touchpad'});
        } catch (e) {
            this._touchpad = null;
        }
        this._sum = 0;
        this._last = 0;
        this._lockedUntil = 0;
    }

    /** @returns {boolean} whether the event was a vertical touchpad swipe and is consumed */
    handle(event) {
        if (event.get_scroll_direction() !== Clutter.ScrollDirection.SMOOTH ||
            event.get_scroll_source() === Clutter.ScrollSource.WHEEL)
            return false;
        const [dx, dy] = event.get_scroll_delta();
        if (dy === 0 || Math.abs(dy) <= Math.abs(dx))
            return false;
        const now = GLib.get_monotonic_time() / 1000;
        if (now < this._lockedUntil)
            return true;
        const natural = this._touchpad?.get_boolean('natural-scroll') ?? true;
        const signed = (natural ? -dy : dy);   // positive: fingers down
        if (now - this._last > GAP_MS || Math.sign(signed) !== Math.sign(this._sum))
            this._sum = 0;
        this._last = now;
        this._sum += signed;
        if (Math.abs(this._sum) >= THRESHOLD) {
            const direction = this._sum > 0 ? 'down' : 'up';
            this._sum = 0;
            this._lockedUntil = now + LOCK_MS;
            this._onPull(direction);
        }
        return true;
    }

    destroy() {
        this._touchpad = null;
    }
}
