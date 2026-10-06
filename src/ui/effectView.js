import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

const TICK_MS = 60;
const BARS = 5;

/**
 * The little animation that shows music playing: dancing bars ("spectrum") or
 * flowing lines ("waves"). Drawn with Cairo, in white or in a colour taken
 * from the album art. It only runs while `playing` is set and it is mapped.
 */
export class EffectView extends St.DrawingArea {
    static {
        GObject.registerClass({GTypeName: 'OsminEffectView'}, this);
    }

    /** @param {{kind?: 'bars'|'waves', color?: number[]|null}} [params] */
    constructor({kind = 'bars', color = null} = {}) {
        super({style_class: 'osmin-effect'});
        this._kind = kind;
        this._color = color;
        this._playing = false;
        this._phase = 0;
        this._levels = Array.from({length: BARS}, () => 0.2);
        this._targets = Array.from({length: BARS}, () => 0.2);
        this._amplitude = 0.15;
        this._tickId = 0;
        this.connect('repaint', () => this._paint());
        this.connect('notify::mapped', () => this._sync());
        this.connect('destroy', () => this._stop());
    }

    setKind(kind) {
        this._kind = kind;
        this.queue_repaint();
    }

    /** @param {number[]|null} color red, green, blue in 0..1; null for white */
    setColor(color) {
        this._color = color;
        this.queue_repaint();
    }

    setPlaying(playing) {
        this._playing = playing;
        this._sync();
    }

    _sync() {
        if (this._playing && this.mapped && !this._tickId) {
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
                this._step();
                return GLib.SOURCE_CONTINUE;
            });
            GLib.Source.set_name_by_id(this._tickId, '[osmin] effect');
        } else if ((!this._playing || !this.mapped) && this._tickId) {
            this._stop();
        }
        if (!this._playing)
            this._rest();
    }

    _stop() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    /** Settles to a calm resting shape. */
    _rest() {
        this._targets.fill(0.2);
        this._levels.fill(0.2);
        this._amplitude = 0.15;
        this.queue_repaint();
    }

    _step() {
        this._phase += 0.35;
        for (let i = 0; i < BARS; i++) {
            if (Math.random() < 0.55)
                this._targets[i] = 0.2 + Math.random() * 0.8;
            this._levels[i] += (this._targets[i] - this._levels[i]) * 0.55;
        }
        this._amplitude += ((0.45 + Math.random() * 0.45) - this._amplitude) * 0.25;
        this.queue_repaint();
    }

    _paint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const [r, g, b] = this._color ?? [1, 1, 1];
        const alpha = this._color ? 0.95 : 0.75;
        cr.setSourceRGBA(r, g, b, alpha);

        if (this._kind === 'waves') {
            cr.setLineWidth(Math.max(1.2, h / 10));
            cr.setLineCap(1);
            for (let line = 0; line < 3; line++) {
                cr.setSourceRGBA(r, g, b, alpha * (1 - line * 0.28));
                const amp = (h / 2 - 1.5) * this._amplitude * (1 - line * 0.2);
                for (let x = 0; x <= w; x += 1) {
                    const t = x / w;
                    const y = h / 2 + amp * Math.sin(t * Math.PI * 2 * (1.3 + line * 0.5) + this._phase * (1 + line * 0.4) + line);
                    if (x === 0)
                        cr.moveTo(x, y);
                    else
                        cr.lineTo(x, y);
                }
                cr.stroke();
            }
        } else {
            const gap = Math.max(1.5, w / 14);
            const bw = (w - gap * (BARS - 1)) / BARS;
            for (let i = 0; i < BARS; i++) {
                const bh = Math.max(bw, h * this._levels[i]);
                const x = i * (bw + gap);
                const y = (h - bh) / 2;
                const rad = bw / 2;
                cr.newSubPath();
                cr.arc(x + rad, y + rad, rad, Math.PI, 2 * Math.PI);
                cr.arc(x + rad, y + bh - rad, rad, 0, Math.PI);
                cr.closePath();
                cr.fill();
            }
        }
        cr.$dispose();
    }
}
