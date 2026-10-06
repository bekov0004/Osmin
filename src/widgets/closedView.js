import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

/** The resting state: just a small dot. */
export class ClosedView extends St.Widget {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this.add_child(new St.Widget({
            style_class: 'osmin-dot',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));
    }
}
