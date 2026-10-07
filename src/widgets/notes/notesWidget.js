import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {createButton} from '../../ui/button.js';
import {OsminWidget} from '../widget.js';

/** One note: its text, with copy and remove buttons on hover. */
class NoteItem extends St.Widget {
    static {
        GObject.registerClass({GTypeName: 'OsminNoteItem'}, this);
    }

    constructor({note, onCopy, onRemove}) {
        super({
            style_class: 'osmin-todo-item',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            track_hover: true,
            x_expand: true,
        });
        const label = new St.Label({
            text: note.text.replace(/\s+/g, ' '),
            style_class: 'osmin-todo-text osmin-note-text',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.add_child(label);

        this._actions = new St.BoxLayout({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            opacity: 0,
        });
        for (const [iconName, handler] of [
            ['edit-copy-symbolic', onCopy],
            ['window-close-symbolic', onRemove],
        ]) {
            this._actions.add_child(createButton({
                iconName,
                styleClass: 'osmin-todo-remove',
                onClick: () => handler(note),
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

/** Quick notes: write a line, press Enter; copy or remove it later. */
export class NotesWidget extends OsminWidget {
    static id = 'notes';
    static title = 'Notes';
    static iconName = 'document-edit-symbolic';

    constructor(context) {
        super(context);
        this._notes = context.services.notes;
        this._ui = context.ui;
        this._typing = false;
    }

    createView() {
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-widget osmin-todo',
            x_expand: true,
            y_expand: true,
        });
        this._caption = new St.Label({style_class: 'osmin-todo-caption'});
        root.add_child(this._caption);

        this._empty = new St.Label({
            text: 'No notes yet',
            style_class: 'osmin-todo-empty',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        root.add_child(this._empty);

        this._scroll = new St.ScrollView({
            style_class: 'osmin-todo-scroll',
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        this._list = new St.BoxLayout({vertical: true, style_class: 'osmin-todo-list', x_expand: true});
        this._scroll.add_child(this._list);
        root.add_child(this._scroll);

        this._entry = new St.Entry({
            hint_text: 'Write a note',
            style_class: 'osmin-todo-entry',
            can_focus: true,
            x_expand: true,
        });
        const text = this._entry.clutter_text;
        text.connect('activate', () => {
            if (this._notes.add(this._entry.text))
                this._entry.text = '';
        });
        text.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this._stopTyping();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        text.connect('key-focus-in', () => this._startTyping());
        root.add_child(this._entry);

        this._notes.connectObject('changed', () => this._rebuild(), this);
        return root;
    }

    onViewCreated() {
        this._rebuild();
    }

    onPageHidden() {
        this._stopTyping();
    }

    destroy() {
        this._notes.disconnectObject(this);
        this._stopTyping();
        super.destroy();
    }

    _startTyping() {
        if (this._typing)
            return;
        this._typing = true;
        this._ui.beginTextInput(() => this._stopTyping(true));
        this._entry.grab_key_focus();
    }

    _stopTyping(fromHost = false) {
        if (!this._typing)
            return;
        this._typing = false;
        if (!fromHost)
            this._ui.endTextInput();
    }

    _rebuild() {
        if (!this._view)
            return;
        const notes = this._notes.notes;
        this._caption.text = notes.length === 0 ? 'NOTES' : `NOTES · ${notes.length}`;
        this._empty.visible = notes.length === 0;
        this._scroll.visible = notes.length > 0;
        this._list.destroy_all_children();
        for (const note of notes) {
            this._list.add_child(new NoteItem({
                note,
                onCopy: n => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, n.text),
                onRemove: n => this._notes.remove(n.id),
            }));
        }
    }
}
