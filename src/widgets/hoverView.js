import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

/** The peek state shown while the pointer hovers the island. */
export class HoverView extends St.Widget {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this.add_child(new St.Label({
            text: 'Osmin',
            style_class: 'osmin-hover-label',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));
    }
}
