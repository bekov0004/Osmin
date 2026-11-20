import Clutter from 'gi://Clutter';
import Cairo from 'cairo';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {animDuration} from '../utils/animation.js';

// The butterfly of the logo (icons/osmin-butterfly.svg), in its coordinates: x -34..34, y -24..27.
const UPPER = [[-2, -2], [-10, -22, -32, -24, -34, -12], [-36, -2, -22, 4, -3, 2]];
const LOWER = [[-3, 2], [-18, 4, -28, 12, -24, 20], [-20, 27, -8, 20, -2, 6]];
const COOL = [[0.435, 0.906, 1], [0.753, 0.545, 1]];               // #6fe7ff → #c08bff
const WARM = [[1, 0.827, 0.431], [1, 0.541, 0.239], [1, 0.239, 0.467]]; // something happened
const FLAP_MS = 900;    // two beats of the wings

/**
 * The butterfly in the middle of the closed capsule (instead of the camera circle). Now and then it beats its wings
 * (flap()): the wings close towards the body and open again, twice. Its wings turn warm while something happened.
 */
export const Butterfly = GObject.registerClass(class OsminButterfly extends St.DrawingArea {
    _init() {
        super._init({style_class: 'osmin-butterfly', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true});
        this._open = 1;         // 1: wings spread, 0: closed against the body
        this._warm = false;
        this._timeline = null;
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

    /** One beat of the wings (twice down and up); nothing when animations are off or it is not on screen. */
    flap() {
        const duration = animDuration(FLAP_MS);
        if (!duration || !this.mapped || this._timeline)
            return;
        this._timeline = new Clutter.Timeline({actor: this, duration});
        this._timeline.connect('new-frame', timeline => {
            const t = timeline.get_progress();
            // two beats; the wings almost close (a butterfly seen from above folds them up)
            this._open = 1 - 0.85 * Math.abs(Math.sin(2 * Math.PI * t));
            this.queue_repaint();
        });
        this._timeline.connect('completed', () => this._stop());
        this._timeline.start();
    }

    _stop() {
        if (this._timeline) {
            this._timeline.stop();
            this._timeline = null;
        }
        this._open = 1;
        this.queue_repaint();
    }

    _wingPattern(sign) {
        const pattern = new Cairo.LinearGradient(sign * -34, -24, sign * -2, 26);
        const colors = this._warm ? WARM : COOL;
        colors.forEach(([r, g, b], i) => pattern.addColorStopRGB(i / (colors.length - 1), r, g, b));
        return pattern;
    }

    _path(cr, [[x, y], ...curves], sign) {
        cr.moveTo(sign * x, y);
        for (const [x1, y1, x2, y2, x3, y3] of curves)
            cr.curveTo(sign * x1, y1, sign * x2, y2, sign * x3, y3);
        cr.closePath();
    }

    _paint(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const scale = Math.min(width / 72, height / 54);
        cr.translate(width / 2, height / 2 - 1.5 * scale);

        for (const sign of [-1, 1]) {
            cr.save();
            // the wings fold towards the body: narrower around x = 0
            cr.scale(scale * Math.max(0.12, this._open), scale);
            cr.setSource(this._wingPattern(sign));
            this._path(cr, UPPER, sign);
            cr.fill();
            cr.pushGroup();
            cr.setSource(this._wingPattern(sign));
            this._path(cr, LOWER, sign);
            cr.fill();
            cr.popGroupToSource();
            cr.paintWithAlpha(0.8);
            cr.restore();
        }

        cr.scale(scale, scale);
        cr.setSourceRGB(1, 1, 1);
        cr.rectangle(-2, -12, 4, 30);
        cr.fill();
        cr.setLineWidth(1.8);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.moveTo(-1, -11);
        cr.curveTo(-3, -16, -6, -20, -9, -22);
        cr.moveTo(1, -11);
        cr.curveTo(3, -16, 6, -20, 9, -22);
        cr.stroke();
        cr.$dispose();
    }
});
