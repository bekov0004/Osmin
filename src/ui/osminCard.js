import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Priority, TYPE_ICONS} from '../utils/events.js';

const PRIORITY_CLASSES = Object.values(Priority).map(p => `osmin-card-${p}`);

/**
 * Base card: icon badge, title, optional description, and a trailing area
 * (dismiss hint for sticky cards, "+N" for cards waiting in the queue).
 * Pure UI; it never touches queues or timers.
 */
export class OsminCard extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminCard'}, this);
    }

    constructor(card) {
        super({
            style_class: 'osmin-card',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._icon = new St.Icon({style_class: 'osmin-card-icon'});
        this.add_child(new St.Bin({
            style_class: 'osmin-card-badge',
            y_align: Clutter.ActorAlign.CENTER,
            child: this._icon,
        }));

        const texts = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-card-texts',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._title = new St.Label({style_class: 'osmin-card-title'});
        this._description = new St.Label({style_class: 'osmin-card-description'});
        for (const label of [this._title, this._description])
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        texts.add_child(this._title);
        texts.add_child(this._description);
        this.add_child(texts);

        this._dismiss = new St.Icon({
            icon_name: 'window-close-symbolic',
            style_class: 'osmin-card-dismiss',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pending = new St.Label({
            style_class: 'osmin-card-pending',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._pending);
        this.add_child(this._dismiss);

        this.update(card);
        this.setPending(0);
    }

    /** Preferred island size in logical px (before UI scaling). */
    getSize() {
        return {width: 304, height: this._card.description ? 56 : 46};
    }

    update(card) {
        this._card = card;

        for (const name of PRIORITY_CLASSES)
            this.remove_style_class_name(name);
        this.add_style_class_name(`osmin-card-${card.priority}`);

        const icon = card.icon ?? TYPE_ICONS[card.type];
        if (icon.startsWith('/'))
            this._icon.gicon = new Gio.FileIcon({file: Gio.File.new_for_path(icon)});
        else
            this._icon.icon_name = icon;

        this._title.text = card.title;
        this._description.text = card.description;
        this._description.visible = card.description !== '';
        this._dismiss.visible = card.persistent;
    }

    setPending(count) {
        this._pending.text = `+${count}`;
        this._pending.visible = count > 0;
    }
}
