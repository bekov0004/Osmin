import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Butterfly} from './butterfly.js';

/**
 * The resting capsule, drawn like a notch: the date on the left of the Osmin
 * butterfly in the middle (or a small "camera" circle), the time on the right.
 * A Live Activity takes both sides over (for example album art on the left, the
 * music effect on the right); the butterfly's wings (the circle's lens) turn
 * warm when something happened.
 */
export class ClosedView extends St.Widget {
    static {
        GObject.registerClass({GTypeName: 'OsminClosedView'}, this);
    }

    constructor() {
        super({
            style_class: 'osmin-closed-view',
            // Left, middle, right: the circle stays exactly in the middle whatever the sides hold.
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this._left = new St.BoxLayout({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        this._right = new St.BoxLayout({
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        this._date = new St.Label({style_class: 'osmin-closed-date', y_align: Clutter.ActorAlign.CENTER});
        this._time = new St.Label({style_class: 'osmin-closed-time', y_align: Clutter.ActorAlign.CENTER});
        this._left.add_child(this._date);
        this._right.add_child(this._time);

        this._camera = new St.Widget({
            style_class: 'osmin-camera',
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        this._lens = new St.Widget({
            style_class: 'osmin-camera-lens',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        this._camera.add_child(this._lens);
        this._butterfly = new Butterfly();
        this._camera.visible = false;

        this.add_child(this._left);
        this.add_child(this._camera);
        this.add_child(this._butterfly);
        this.add_child(this._right);
        this._compact = null;
    }

    /** Replaces the date and time with the parts of a Live Activity (or restores them). */
    setCompact(parts) {
        for (const actor of this._compact ? [this._compact.left, this._compact.right] : [])
            actor.destroy();
        this._compact = parts;
        this._date.visible = !parts;
        this._time.visible = !parts;
        if (parts) {
            this._left.add_child(parts.left);
            this._right.add_child(parts.right);
        }
    }

    setTime(text) {
        this._time.text = text;
    }

    setDate(text) {
        this._date.text = text;
    }

    /** The butterfly in the middle (true) or the camera circle (false). */
    setButterfly(on) {
        this._butterfly.visible = on;
        this._camera.visible = !on;
    }

    /** The butterfly beats its wings once. */
    flap() {
        if (this._butterfly.visible)
            this._butterfly.flap();
    }

    /** Something happened: the butterfly's wings turn warm (the camera's lens glows amber), and it flaps. */
    setActivity(active) {
        if (active)
            this._lens.add_style_class_name('osmin-camera-lens-active');
        else
            this._lens.remove_style_class_name('osmin-camera-lens-active');
        if (active && !this._butterfly.warm)
            this.flap();
        this._butterfly.warm = active;
    }

    /** Natural width in px, used to size the collapsed capsule. */
    getNaturalWidth() {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const side = Math.max(this._left.get_preferred_width(-1)[1], this._right.get_preferred_width(-1)[1]);
        const middle = (this._butterfly.visible ? this._butterfly : this._camera).get_preferred_width(-1)[1];
        const padding = this.get_theme_node().get_horizontal_padding();
        return 2 * side + middle + 2 * Math.round(10 * scale) + padding;
    }
}
