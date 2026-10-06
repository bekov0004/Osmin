import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

/** The resting capsule: the current time and a dot when something happened. */
export class ClosedView extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminClosedView'}, this);
    }

    constructor() {
        super({
            style_class: 'osmin-closed-view',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._time = new St.Label({
            style_class: 'osmin-closed-time',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._dot = new St.Widget({
            style_class: 'osmin-activity-dot',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this.add_child(this._time);
        this.add_child(this._dot);
    }

    setTime(text) {
        this._time.text = text;
    }

    setActivity(active) {
        this._dot.visible = active;
    }

    /** Natural width in px, used to size the collapsed capsule. */
    getNaturalWidth() {
        return this.get_preferred_width(-1)[1];
    }
}
