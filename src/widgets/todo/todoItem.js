import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {createButton} from '../../ui/button.js';

/** One task: a check circle, the text (struck through when done) and a remove button on hover. */
export class TodoItem extends St.Widget {
    static {
        GObject.registerClass({GTypeName: 'OsminTodoItem'}, this);
    }

    /** @param {{item: object, onToggle: Function, onRemove: Function}} params */
    constructor({item, onToggle, onRemove}) {
        super({
            style_class: `osmin-todo-item${item.done ? ' osmin-todo-done' : ''}`,
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            track_hover: true,
            x_expand: true,
        });

        const row = new St.BoxLayout({x_expand: true, style_class: 'osmin-todo-row'});
        const check = new St.Button({
            style_class: 'osmin-todo-check',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'object-select-symbolic', style_class: 'osmin-todo-check-icon'}),
        });
        check.child.opacity = item.done ? 255 : 0;
        check.connect('clicked', () => onToggle(item.id));
        row.add_child(check);

        const label = new St.Label({
            text: item.text,
            style_class: 'osmin-todo-text',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        row.add_child(label);
        this.add_child(row);

        this._remove = createButton({
            iconName: 'window-close-symbolic',
            styleClass: 'osmin-todo-remove',
            onClick: () => onRemove(item.id),
        });
        this._remove.set({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            opacity: 0,
        });
        this.add_child(this._remove);
        this.connect('notify::hover', () => this._remove.ease({
            opacity: this.hover ? 255 : 0,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        }));
    }
}
