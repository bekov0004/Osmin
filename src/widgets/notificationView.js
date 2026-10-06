import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

/** The transient state: a check mark and a short message. */
export class NotificationView extends St.BoxLayout {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            style_class: 'osmin-notify-view',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const badge = new St.Bin({
            style_class: 'osmin-notify-badge',
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'object-select-symbolic',
                style_class: 'osmin-notify-icon',
            }),
        });
        this.add_child(badge);

        this._label = new St.Label({
            style_class: 'osmin-notify-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);
    }

    setMessage(text) {
        this._label.text = text;
    }
}
