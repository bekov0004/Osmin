import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {createButton} from '../ui/button.js';
import {makeDraggable} from './dragHandle.js';

/** One file in the tray: icon or thumbnail, name, and actions shown on hover. */
export class FileItem extends St.Widget {
    static {
        GObject.registerClass({GTypeName: 'OsminFileItem'}, this);
    }

    /**
     * @param {{item: object, onOpen, onShowInFolder, onCopy, onSend, onRemove, drag?: {arm, disarm, prepare, begin, cancel}}} params
     *   drag: hooks that let the file be dragged out into other applications
     */
    constructor({item, onOpen, onShowInFolder, onCopy, onSend, onRemove, drag}) {
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
            ['mail-send-symbolic', onSend],
            ['window-close-symbolic', onRemove],
        ]) {
            this._actions.add_child(createButton({
                iconName,
                styleClass: 'osmin-file-action',
                onClick: () => handler(item.uri),
            }));
        }
        this.add_child(this._actions);

        if (drag)
            makeDraggable(this, {payload: [item.uri], drag, isAction: event => this._pressOnAction(event)});
        this.connect('notify::hover', () => {
            this._actions.ease({
                opacity: this.hover ? 255 : 0,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
    }

    /** Whether the press landed on one of the small action buttons. */
    _pressOnAction(event) {
        const [x, y] = event.get_coords();
        const target = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        return !!target && target !== this._actions && this._actions.contains(target);
    }
}
