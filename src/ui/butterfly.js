import Clutter from 'gi://Clutter';
import Cairo from 'cairo';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {animDuration} from '../utils/animation.js';

// The little butterfly of the capsule, looking at you: a round face, big eyes, pink cheeks, a smile, round wings and
// antennae. Coordinates: x -38..38, y -32..32 (dist/butterfly-face/C-chibi.svg).
const UPPER = [-20, -6, 16, 12, -25];   // cx, cy, rx, ry, rotation (degrees) of the left upper wing
const LOWER = [-15, 13, 10, 8, 25];
const FACE = [0.914, 0.902, 1];          // #e9e6ff
const COOL = [[0.435, 0.906, 1], [0.753, 0.545, 1]];               // #6fe7ff → #c08bff
const WARM = [[1, 0.827, 0.431], [1, 0.541, 0.239], [1, 0.239, 0.467]]; // something happened
const FLAP_MS = 900;    // two beats of the wings
const BLINK_AFTER_MS = 900;
const BLINK_MS = 150;

/**
 * The butterfly in the middle of the closed capsule (instead of the camera circle). Now and then it beats its wings
 * (flap()): they fold towards the body and open again, twice; a moment later it blinks. Its wings turn warm while
 * something happened.
 */
export const Butterfly = GObject.registerClass(class OsminButterfly extends St.DrawingArea {
    _init() {
        super._init({style_class: 'osmin-butterfly', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true});
        this._open = 1;         // 1: wings spread, 0: folded against the body
        this._blink = false;
        this._warm = false;
        this._timeline = null;
        this._timers = new Set();
        this.connect('repaint', area => this._paint(area));
        this.connect('destroy', () => this._stop());
    }

    get warm() {
        return this._warm;
    }

    set warm(warm) {
        if (this._warm === warm)
            return;
        this._warm = warm;
        this.queue_repaint();
    }

    /** Two beats of the wings, then a blink; nothing when animations are off or it is not on screen. */
    flap() {
        const duration = animDuration(FLAP_MS);
        if (!duration || !this.mapped || this._timeline || this._flutter)
            return;
        this._timeline = new Clutter.Timeline({actor: this, duration});
        this._timeline.connect('new-frame', timeline => {
            this._open = 1 - 0.85 * Math.abs(Math.sin(2 * Math.PI * timeline.get_progress()));
            this.queue_repaint();
        });
        this._timeline.connect('completed', () => {
            this._timeline = null;
            this._open = 1;
            this.queue_repaint();
            this._later(BLINK_AFTER_MS, () => this.blink());
        });
        this._timeline.start();
    }

    /**
     * Beats its wings on and on, one beat every `periodMs` (flying), until stopFlutter(); blinks now and then.
     * Nothing when animations are off.
     */
    flutter(periodMs = 320) {
        this.stopFlutter();
        if (!animDuration(periodMs))
            return;
        this._timeline?.stop();
        this._timeline = null;
        this._flutter = new Clutter.Timeline({actor: this, duration: periodMs, repeat_count: -1});
        this._flutter.connect('new-frame', timeline => {
            this._open = 1 - 0.8 * Math.abs(Math.sin(Math.PI * timeline.get_progress()));
            this.queue_repaint();
        });
        this._flutter.start();
        this._blinker = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2600, () => {
            this.blink();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stopFlutter() {
        this._flutter?.stop();
        this._flutter = null;
        if (this._blinker)
            GLib.source_remove(this._blinker);
        this._blinker = 0;
        this._open = 1;
        this.queue_repaint();
    }

    /** It closes its eyes for a moment. */
    blink() {
        if (!this.mapped || this._blink)
            return;
        this._blink = true;
        this.queue_repaint();
        this._later(BLINK_MS, () => {
            this._blink = false;
            this.queue_repaint();
        });
    }

    _later(ms, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timers.delete(id);
            callback();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.add(id);
    }

    _stop() {
        this.stopFlutter();
        this._timeline?.stop();
        this._timeline = null;
        for (const id of this._timers)
            GLib.source_remove(id);
        this._timers.clear();
        this._open = 1;
        this._blink = false;
    }

    _wingPattern(sign) {
        const pattern = new Cairo.LinearGradient(sign * -36, -18, sign * -4, 22);
        const colors = this._warm ? WARM : COOL;
        colors.forEach(([r, g, b], i) => pattern.addColorStopRGB(i / (colors.length - 1), r, g, b));
        return pattern;
    }

    _ellipse(cr, cx, cy, rx, ry, degrees) {
        cr.save();
        cr.translate(cx, cy);
        cr.rotate(degrees * Math.PI / 180);
        cr.scale(rx, ry);
        cr.arc(0, 0, 1, 0, 2 * Math.PI);
        cr.restore();
    }

    _paint(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const scale = Math.min(width / 76, height / 64);
        cr.translate(width / 2, height / 2);
        cr.scale(scale, scale);

        // the wings, folding towards the body
        for (const sign of [-1, 1]) {
            cr.save();
            cr.scale(Math.max(0.12, this._open), 1);
            const [ux, uy, urx, ury, ur] = UPPER;
            cr.setSource(this._wingPattern(sign));
            this._ellipse(cr, sign * ux, uy, urx, ury, sign * ur);
            cr.fill();
            const [lx, ly, lrx, lry, lr] = LOWER;
            cr.pushGroup();
            cr.setSource(this._wingPattern(sign));
            this._ellipse(cr, sign * lx, ly, lrx, lry, sign * lr);
            cr.fill();
            cr.popGroupToSource();
            cr.paintWithAlpha(0.8);
            cr.restore();
        }

        // antennae
        cr.setSourceRGB(...FACE);
        cr.setLineWidth(2);
        cr.setLineCap(Cairo.LineCap.ROUND);
        for (const sign of [-1, 1]) {
            // quadratic (5,-12) (9,-22) (14,-25) as a cubic
            cr.moveTo(sign * 5, -12);
            cr.curveTo(sign * 7.67, -18.67, sign * 10.67, -23, sign * 14, -25);
            cr.stroke();
            cr.arc(sign * 14, -25, 2.4, 0, 2 * Math.PI);
            cr.fill();
        }

        // the face
        cr.arc(0, 2, 13, 0, 2 * Math.PI);
        cr.fill();
        const r = 4.6;
        for (const sign of [-1, 1]) {
            const x = sign * 5.4;
            if (this._blink) {
                cr.setSourceRGB(0.04, 0.04, 0.063);
                cr.setLineWidth(r * 0.45);
                cr.moveTo(x - r, 0);
                cr.curveTo(x - r / 3, r * 0.47, x + r / 3, r * 0.47, x + r, 0);
                cr.stroke();
                continue;
            }
            cr.setSourceRGB(1, 1, 1);
            cr.arc(x, 0, r, 0, 2 * Math.PI);
            cr.fill();
            cr.setSourceRGB(0.04, 0.04, 0.063);
            cr.arc(x, r * 0.1, r * 0.55, 0, 2 * Math.PI);
            cr.fill();
            cr.setSourceRGB(1, 1, 1);
            cr.arc(x + r * 0.22, -r * 0.15, r * 0.18, 0, 2 * Math.PI);
            cr.fill();
        }
        // cheeks and a smile
        cr.setSourceRGBA(1, 0.62, 0.78, 0.7);
        for (const sign of [-1, 1]) {
            cr.arc(sign * 8.5, 7, 2, 0, 2 * Math.PI);
            cr.fill();
        }
        cr.setSourceRGB(0.04, 0.04, 0.063);
        cr.setLineWidth(1.4);
        cr.moveTo(-3, 8);
        cr.curveTo(-1, 9.67, 1, 9.67, 3, 8);
        cr.stroke();
        cr.$dispose();
    }
});
