import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

/** The capsule while files are dragged over the top of the screen. */
export class DropView extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminDropView'}, this);
    }

    constructor() {
        super({
            style_class: 'osmin-drop-view',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._count = 0;
        this._armed = false;

        this._icon = new St.Icon({
            icon_name: 'folder-download-symbolic',
            style_class: 'osmin-drop-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._icon);

        const texts = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
        this._title = new St.Label({style_class: 'osmin-drop-title'});
        this._hint = new St.Label({style_class: 'osmin-drop-hint'});
        texts.add_child(this._title);
        texts.add_child(this._hint);
        this.add_child(texts);
        this._update();
    }

    setCount(count) {
        this._count = count;
        this._update();
    }

    /** Armed: the pointer is over the capsule, so releasing now adds the files. */
    setArmed(armed) {
        if (armed === this._armed)
            return;
        this._armed = armed;
        this._update();
    }

    _update() {
        const files = this._count === 1 ? '1 file' : `${this._count} files`;
        this._title.text = this._armed ? 'Release to add' : 'Drop to add to Osmin';
        this._hint.text = files;
        if (this._armed)
            this.add_style_pseudo_class('active');
        else
            this.remove_style_pseudo_class('active');
    }
}
