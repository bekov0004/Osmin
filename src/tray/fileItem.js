import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {createButton} from '../ui/button.js';

/** One file in the tray: icon or thumbnail, name, and actions shown on hover. */
export class FileItem extends St.Widget {
    static {
        GObject.registerClass({GTypeName: 'OsminFileItem'}, this);
    }

    /** @param {{item: object, onOpen, onShowInFolder, onCopy, onRemove}} params */
    constructor({item, onOpen, onShowInFolder, onCopy, onRemove}) {
        super({
            style_class: 'osmin-file-item',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            track_hover: true,
        });

        const main = new St.Button({
            style_class: 'osmin-file-main',
            x_expand: true,
            y_expand: true,
            can_focus: true,
        });
        const box = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER});
        box.add_child(new St.Icon({
            gicon: item.thumbnail ?? item.icon,
            style_class: 'osmin-file-icon',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        const name = new St.Label({text: item.name, style_class: 'osmin-file-name'});
        name.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        name.x_align = Clutter.ActorAlign.CENTER;
        box.add_child(name);
        main.set_child(box);
        main.connect('clicked', () => onOpen(item.uri));
        this.add_child(main);

        this._actions = new St.BoxLayout({
            style_class: 'osmin-file-actions',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
            opacity: 0,
        });
        for (const [iconName, handler] of [
            ['folder-open-symbolic', onShowInFolder],
            ['edit-copy-symbolic', onCopy],
            ['window-close-symbolic', onRemove],
        ]) {
            this._actions.add_child(createButton({
                iconName,
                styleClass: 'osmin-file-action',
                onClick: () => handler(item.uri),
            }));
        }
        this.add_child(this._actions);
        this.connect('notify::hover', () => this._actions.ease({
            opacity: this.hover ? 255 : 0,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        }));
    }
}
