import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {createButton} from '../ui/button.js';

const PREVIEW_CHARS = 110;

function ago(at) {
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (seconds < 60)
        return 'now';
    if (seconds < 3600)
        return `${Math.round(seconds / 60)} min`;
    if (seconds < 86400)
        return `${Math.round(seconds / 3600)} h`;
    return `${Math.round(seconds / 86400)} d`;
}

/** One item of the history: its text, when, and hover actions (copy, pin, remove). */
class ClipCard extends St.Widget {
    static {
        GObject.registerClass({GTypeName: 'OsminClipCard'}, this);
    }

    constructor({item, onPaste, onCopy, onPin, onRemove}) {
        super({
            style_class: 'osmin-clip',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            track_hover: true,
        });
        if (item.saved)
            this.add_style_class_name('osmin-clip-saved');

        const main = new St.Button({
            style_class: 'osmin-clip-main',
            x_expand: true,
            y_expand: true,
            can_focus: true,
        });
        const box = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true});
        const flat = item.text.replace(/\s+/g, ' ').trim();
        const preview = new St.Label({
            text: flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat,
            style_class: 'osmin-clip-text',
            y_expand: true,
            y_align: Clutter.ActorAlign.START,
        });
        preview.clutter_text.line_wrap = true;
        preview.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        preview.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(preview);

        const foot = new St.BoxLayout({style_class: 'osmin-clip-foot'});
        if (item.saved) {
            foot.add_child(new St.Icon({
                icon_name: 'starred-symbolic',
                style_class: 'osmin-clip-star',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        foot.add_child(new St.Label({
            text: item.note ? 'Note' : ago(item.at),
            style_class: 'osmin-clip-when',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(foot);
        main.set_child(box);
        main.connect('clicked', () => onPaste(item));
        this.add_child(main);

        this._actions = new St.BoxLayout({
            style_class: 'osmin-clip-actions',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            opacity: 0,
        });
        for (const [iconName, handler] of [
            ['edit-copy-symbolic', onCopy],
            [item.saved ? 'non-starred-symbolic' : 'starred-symbolic', onPin],
            ['window-close-symbolic', onRemove],
        ]) {
            this._actions.add_child(createButton({
                iconName,
                styleClass: 'osmin-clip-action',
                onClick: () => handler(item),
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

/**
 * The Clipboard tab of the capsule: a row of cards, the newest first. A click
 * puts the item into the app you were in; the first card is a place to write
 * your own notes.
 */
export class ClipboardView extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminClipboardView'}, this);
    }

    /**
     * @param {{service: ClipboardService, ui: {beginTextInput, endTextInput},
     *          onPaste: (item) => void}} params
     */
    constructor({service, ui, onPaste}) {
        super({
            vertical: true,
            style_class: 'osmin-tray osmin-clipboard',
            x_expand: true,
            y_expand: true,
        });
        this._service = service;
        this._ui = ui;
        this._onPaste = onPaste;
        this._typing = false;

        const header = new St.BoxLayout({style_class: 'osmin-tray-header'});
        this._caption = new St.Label({
            style_class: 'osmin-tray-caption',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._caption);
        this._clear = new St.Button({label: 'Clear', style_class: 'osmin-tray-clear', can_focus: true});
        this._clear.connect('clicked', () => this._service.clear());
        header.add_child(this._clear);
        this.add_child(header);

        this._scroll = new St.ScrollView({
            style_class: 'osmin-tray-scroll',
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.EXTERNAL,
            vscrollbar_policy: St.PolicyType.NEVER,
        });
        this._row = new St.BoxLayout({style_class: 'osmin-tray-row', y_expand: true});
        this._scroll.add_child(this._row);
        this._scroll.connect('scroll-event', (_actor, event) => this._onScroll(event));
        this.add_child(this._scroll);

        this._buildNoteCard();
        this._service.connectObject('changed', () => this._rebuild(), this);
        this._rebuild();
    }

    destroy() {
        this._service.disconnectObject(this);
        this.stopTyping();
        super.destroy();
    }

    /** The tab was left or the capsule closed. */
    stopTyping(fromHost = false) {
        if (!this._typing)
            return;
        this._typing = false;
        if (!fromHost)
            this._ui.endTextInput();
    }

    _buildNoteCard() {
        this._noteCard = new St.BoxLayout({vertical: true, style_class: 'osmin-clip osmin-clip-new'});
        this._noteCard.add_child(new St.Label({text: 'NEW NOTE', style_class: 'osmin-clip-when'}));
        this._entry = new St.Entry({
            hint_text: 'Write something…',
            style_class: 'osmin-clip-entry',
            can_focus: true,
            x_expand: true,
            y_expand: true,
        });
        const text = this._entry.clutter_text;
        text.connect('activate', () => {
            if (this._service.addNote(this._entry.text))
                this._entry.text = '';
        });
        text.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.stopTyping();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        text.connect('key-focus-in', () => this._startTyping());
        this._noteCard.add_child(this._entry);
        this._noteCard.add_child(new St.Label({text: 'Enter saves it', style_class: 'osmin-clip-when'}));
    }

    _startTyping() {
        if (this._typing)
            return;
        this._typing = true;
        this._ui.beginTextInput(() => this.stopTyping(true));
        this._entry.grab_key_focus();
    }

    _rebuild() {
        // Keep the entry (and what is typed in it) alive across rebuilds.
        if (this._noteCard.get_parent() === this._row)
            this._row.remove_child(this._noteCard);
        this._row.destroy_all_children();
        this._row.add_child(this._noteCard);

        const items = this._service.items;
        this._caption.text = items.length === 0 ? 'CLIPBOARD' : `CLIPBOARD · ${items.length}`;
        this._clear.visible = this._service.hasUnsaved;
        for (const item of items) {
            this._row.add_child(new ClipCard({
                item,
                onPaste: i => this._onPaste(i),
                onCopy: i => this._service.copy(i.id),
                onPin: i => this._service.togglePin(i.id),
                onRemove: i => this._service.remove(i.id),
            }));
        }
    }

    _onScroll(event) {
        const adjustment = this._scroll.hadjustment;
        if (adjustment.upper <= adjustment.page_size)
            return Clutter.EVENT_PROPAGATE;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            adjustment.value -= 90;
            return Clutter.EVENT_STOP;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            adjustment.value += 90;
            return Clutter.EVENT_STOP;
        case Clutter.ScrollDirection.SMOOTH: {
            const [dx, dy] = event.get_scroll_delta();
            adjustment.value += (Math.abs(dx) > Math.abs(dy) ? dx : dy) * 40;
            return Clutter.EVENT_STOP;
        }
        }
        return Clutter.EVENT_PROPAGATE;
    }
}
