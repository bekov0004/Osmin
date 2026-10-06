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
        this._color = [0, 0, 0, 0.96];
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
        const left = this._side === 'left';
        const radius = Math.min(width, height);
        cr.arc(left ? 0 : width, height, radius, 0, 2 * Math.PI);
        cr.fill();

        // The capsule's thin side border carries on along the curve, up to the screen edge.
        cr.rectangle(0, 0, width, height);
        cr.clip();
        cr.newPath();
        if (left)
            cr.arc(0, height, radius + 0.5, -Math.PI / 2, 0);
        else
            cr.arc(width, height, radius + 0.5, Math.PI, 1.5 * Math.PI);
        cr.setSourceRGBA(1, 1, 1, 0.10);
        cr.setLineWidth(1);
        cr.stroke();
        cr.$dispose();
    }
}
