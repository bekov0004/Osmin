import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

/** The Osmin mark, drawn: a planet with a ring. Shown at the top of the top-bar window. */
export const Logo = GObject.registerClass(class Logo extends St.DrawingArea {
    _init() {
        super._init({style_class: 'osmin-logo', width: 64, height: 34, x_align: Clutter.ActorAlign.CENTER});
        this.connect('repaint', area => this._paint(area));
    }

    _paint(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const cx = width / 2;
        const cy = height / 2;
        const ring = () => {
            cr.save();
            cr.translate(cx, cy);
            cr.rotate(-0.28);
            cr.scale(1, 0.3);
            cr.arc(0, 0, width * 0.46, 0, 2 * Math.PI);
            cr.restore();
        };
        // The back half of the ring, the planet, then the front half over it.
        cr.setSourceRGBA(1, 1, 1, 0.95);
        cr.setLineWidth(3);
        ring();
        cr.stroke();
        cr.arc(cx, cy, height * 0.34, 0, 2 * Math.PI);
        cr.setSourceRGBA(1, 1, 1, 0.96);
        cr.fill();
        // The ring crosses the planet: a dark gap, then the front arc.
        cr.save();
        cr.rectangle(0, cy, width, height);
        cr.clip();
        cr.setSourceRGBA(0.13, 0.13, 0.16, 1);
        cr.setLineWidth(6.5);
        ring();
        cr.stroke();
        cr.setSourceRGBA(1, 1, 1, 0.95);
        cr.setLineWidth(3);
        ring();
        cr.stroke();
        cr.restore();
        cr.$dispose();
    }
});
