import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {OsminWidget} from '../widget.js';

const FRAME_MS = 40;

/**
 * Companion: a small friend that lives in the capsule. Its eyes follow the pointer, it blinks, it
 * sways to the music, looks surprised when a card pops up, and falls asleep when nothing happens.
 */
export class CompanionWidget extends OsminWidget {
    static id = 'companion';
    static title = 'Companion';
    static iconName = 'face-smile-symbolic';

    constructor(context) {
        super(context);
        this._media = context.services.media;
        this._events = context.events;
        this._tickId = 0;
        this._t = 0;
        this._blink = 0;          // seconds left of a blink
        this._nextBlink = 2.5;
        this._surprise = 0;       // seconds left of being surprised
        this._idle = 0;           // seconds since the pointer last moved
        this._last = [0, 0];
        this._unsubscribe = null;
    }

    start() {
        // A card appearing surprises the companion (all capsules' widgets would do it: only the first one starts).
        this._unsubscribe = this._events.subscribe(() => {
            this._surprise = 1.2;
        });
    }

    createView() {
        this._area = new St.DrawingArea({style_class: 'osmin-companion', x_expand: true, y_expand: true});
        this._area.connect('repaint', area => this._paint(area));
        return this._area;
    }

    onPageShown() {
        if (this._tickId)
            return;
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FRAME_MS, () => {
            this._step(FRAME_MS / 1000);
            return GLib.SOURCE_CONTINUE;
        });
    }

    onPageHidden() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    _step(dt) {
        this._t += dt;
        const [x, y] = global.get_pointer();
        if (Math.hypot(x - this._last[0], y - this._last[1]) > 2)
            this._idle = 0;
        else
            this._idle += dt;
        this._last = [x, y];
        this._nextBlink -= dt;
        if (this._nextBlink <= 0) {
            this._blink = 0.14;
            this._nextBlink = 2 + Math.random() * 4;
        }
        this._blink = Math.max(0, this._blink - dt);
        this._surprise = Math.max(0, this._surprise - dt);
        this._area?.queue_repaint();
    }

    _paint(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const size = Math.min(width, height);
        const playing = !!this._media?.active?.isPlaying;
        const asleep = this._idle > 25 && !playing;
        const sway = playing ? Math.sin(this._t * 5) * size * 0.04 : Math.sin(this._t * 1.5) * size * 0.012;
        const bob = playing ? Math.abs(Math.sin(this._t * 5)) * size * 0.05 : 0;
        const cx = width / 2 + sway;
        const cy = height / 2 + size * 0.04 - bob;
        const radius = size * 0.36;

        // The body: a soft rounded square.
        const r = radius * 0.55;
        cr.newSubPath();
        cr.arc(cx + radius - r, cy - radius + r, r, -Math.PI / 2, 0);
        cr.arc(cx + radius - r, cy + radius - r, r, 0, Math.PI / 2);
        cr.arc(cx - radius + r, cy + radius - r, r, Math.PI / 2, Math.PI);
        cr.arc(cx - radius + r, cy - radius + r, r, Math.PI, Math.PI * 1.5);
        cr.closePath();
        cr.setSourceRGBA(0.55, 0.72, 1.0, 1);
        cr.fillPreserve();
        cr.setSourceRGBA(1, 1, 1, 0.25);
        cr.setLineWidth(size * 0.015);
        cr.stroke();

        // The eyes look at the pointer.
        const [px, py] = global.get_pointer();
        const [ok, ax, ay] = area.transform_stage_point?.(px, py) ?? [false, cx, cy];
        const eyeY = cy - radius * 0.12;
        const eyeDx = radius * 0.42;
        for (const side of [-1, 1]) {
            const ex = cx + side * eyeDx;
            const eyeR = radius * (this._surprise > 0 ? 0.26 : 0.2);
            let lookX = 0, lookY = 0;
            if (ok) {
                const dx = ax - ex, dy = ay - eyeY;
                const d = Math.max(1, Math.hypot(dx, dy));
                lookX = dx / d * eyeR * 0.45;
                lookY = dy / d * eyeR * 0.45;
            }
            cr.setSourceRGBA(1, 1, 1, 1);
            if (asleep || this._blink > 0) {
                cr.setSourceRGBA(0.1, 0.12, 0.2, 1);
                cr.setLineWidth(size * 0.025);
                cr.moveTo(ex - eyeR, eyeY);
                cr.lineTo(ex + eyeR, eyeY);
                cr.stroke();
            } else {
                cr.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
                cr.fill();
                cr.setSourceRGBA(0.1, 0.12, 0.2, 1);
                cr.arc(ex + lookX, eyeY + lookY, eyeR * 0.5, 0, Math.PI * 2);
                cr.fill();
            }
        }

        // The mouth: a smile; round when surprised; a little "z" when asleep.
        cr.setSourceRGBA(0.1, 0.12, 0.2, 1);
        cr.setLineWidth(size * 0.025);
        if (this._surprise > 0) {
            cr.arc(cx, cy + radius * 0.42, radius * 0.1, 0, Math.PI * 2);
            cr.fill();
        } else {
            cr.arc(cx, cy + radius * 0.2, radius * (playing ? 0.34 : 0.26), 0.15 * Math.PI, 0.85 * Math.PI);
            cr.stroke();
        }
        if (asleep) {
            cr.selectFontFace('sans', 0, 1);
            cr.setFontSize(size * 0.16);
            cr.setSourceRGBA(1, 1, 1, 0.7);
            cr.moveTo(cx + radius * 0.9, cy - radius * 0.7 + Math.sin(this._t * 2) * 3);
            cr.showText('z');
        }
        cr.$dispose();
    }

    destroy() {
        this.onPageHidden();
        this._unsubscribe?.();
        super.destroy();
    }
}
