import Cairo from 'gi://cairo';
import GObject from 'gi://GObject';
import St from 'gi://St';

/**
 * A small concave fillet where the expanded capsule meets the bottom edge of
 * the top bar, so the capsule looks like it hangs from the bar (as a notch does) instead of overlapping it. One on each side.
 */
export class Ear extends St.DrawingArea {
    static {
        GObject.registerClass({GTypeName: 'OsminEar'}, this);
    }

    /** @param {'left'|'right'} side which side of the capsule it is on */
    constructor(side) {
        super({reactive: false, visible: false, opacity: 0});
        this._side = side;
        this._color = [14, 14, 16, 0.96];
    }

    setColor(r, g, b, a) {
        this._color = [r, g, b, a];
        this.queue_repaint();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        const [r, g, b, a] = this._color;
        // The box minus a circle centred on its far bottom corner: the black
        // that remains hugs the bar above and the capsule beside it.
        cr.setSourceRGBA(r / 255, g / 255, b / 255, a);
        cr.setFillRule(Cairo.FillRule.EVEN_ODD);
        cr.rectangle(0, 0, width, height);
        cr.arc(this._side === 'left' ? 0 : width, height, Math.min(width, height), 0, 2 * Math.PI);
        cr.fill();
        cr.$dispose();
    }
}
