import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {createButton} from '../ui/button.js';

const PREVIEW_CHARS = 140;

const isLink = text => /^https?:\/\/\S+$/.test(text.trim());

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

/** One item of the history: a single row (kind, text, when); hover shows copy / pin / remove. */
class ClipRow extends St.Widget {
    static {
        GObject.registerClass({GTypeName: 'OsminClipRow'}, this);
    }

    constructor({item, onPaste, onCopy, onPin, onRemove}) {
        super({
            style_class: 'osmin-clip',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            track_hover: true,
            x_expand: true,
        });
        if (item.saved)
            this.add_style_class_name('osmin-clip-saved');

        const main = new St.Button({style_class: 'osmin-clip-main', x_expand: true, can_focus: true});
        const row = new St.BoxLayout({x_expand: true, style_class: 'osmin-clip-row'});
        let flat = item.text.replace(/\s+/g, ' ').trim();
        let fileIcon = null;
        if (item.files?.length) {
            // Copied files: the file's icon and name instead of the path.
            const first = Gio.File.new_for_uri(item.files[0]);
            flat = first.get_basename() + (item.files.length > 1 ? `  +${item.files.length - 1}` : '');
            try {
                fileIcon = first.query_info('standard::symbolic-icon', Gio.FileQueryInfoFlags.NONE, null).get_symbolic_icon();
            } catch (e) {
                fileIcon = null;
            }
        }
        let iconName = 'text-x-generic-symbolic';
        if (item.saved)
            iconName = 'starred-symbolic';
        else if (isLink(item.text))
            iconName = 'insert-link-symbolic';
        const kind = new St.Icon({
            icon_name: iconName,
            style_class: item.saved ? 'osmin-clip-star' : 'osmin-clip-kind',
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (fileIcon && !item.saved)
            kind.gicon = fileIcon;
        row.add_child(kind);
        const text = new St.Label({
            text: flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat,
            style_class: 'osmin-clip-text',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        text.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        row.add_child(text);
        this._when = new St.Label({
            text: item.note ? 'Note' : ago(item.at),
            style_class: 'osmin-clip-when',
            y_align: Clutter.ActorAlign.CENTER,
        });
        row.add_child(this._when);
        main.set_child(row);
        main.connect('clicked', () => onPaste(item));
        this.add_child(main);

        // The actions replace the time while the pointer is on the row.
        this._actions = new St.BoxLayout({
            style_class: 'osmin-clip-actions',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            opacity: 0,
            visible: false,
        });
        for (const [name, handler] of [
            ['edit-copy-symbolic', onCopy],
            [item.saved ? 'non-starred-symbolic' : 'starred-symbolic', onPin],
            ['window-close-symbolic', onRemove],
        ]) {
            this._actions.add_child(createButton({
                iconName: name,
                styleClass: 'osmin-clip-action',
                onClick: () => handler(item),
            }));
        }
        this.add_child(this._actions);
        this.connect('notify::hover', () => {
            this._when.opacity = this.hover ? 0 : 255;
            this._actions.visible = this.hover;
            this._actions.opacity = this.hover ? 255 : 0;
        });
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


        this._noteMode = false;
        this._buildBar();
        this.add_child(this._bar);
        const body = new St.BoxLayout({style_class: 'osmin-clipboard-body', x_expand: true, y_expand: true});
        this._scroll = new St.ScrollView({
            style_class: 'osmin-tray-scroll',
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        this._list = new St.BoxLayout({vertical: true, style_class: 'osmin-clip-list', x_expand: true});
        this._scroll.add_child(this._list);
        this._empty = new St.Label({
            text: 'Copied text shows up here',
            style_class: 'osmin-todo-empty',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        body.add_child(this._scroll);
        body.add_child(this._empty);
        this.add_child(body);

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

    /** The search field, which turns into a note field with the "+ Note" button. */
    _buildBar() {
        this._bar = new St.BoxLayout({style_class: 'osmin-clip-bar', x_expand: true});
        this._entry = new St.Entry({
            hint_text: 'Search…',
            style_class: 'osmin-clip-entry',
            can_focus: true,
            x_expand: true,
        });
        this._entry.set_primary_icon(new St.Icon({icon_name: 'edit-find-symbolic', style_class: 'osmin-clip-find'}));
        const text = this._entry.clutter_text;
        text.connect('text-changed', () => {
            if (!this._noteMode)
                this._rebuild();
        });
        text.connect('activate', () => {
            if (this._noteMode && this._service.addNote(this._entry.text))
                this._setNoteMode(false);
        });
        text.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                if (this._noteMode)
                    this._setNoteMode(false);
                else if (this._entry.text)
                    this._entry.text = '';
                else
                    this.stopTyping();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        text.connect('key-focus-in', () => this._startTyping());
        this._bar.add_child(this._entry);
        this._addNote = new St.Button({label: '+ Note', style_class: 'osmin-clip-add', can_focus: true});
        this._addNote.connect('clicked', () => this._setNoteMode(!this._noteMode));
        this._bar.add_child(this._addNote);
        this._clear = new St.Button({label: 'Clear', style_class: 'osmin-clip-add', can_focus: true});
        this._clear.connect('clicked', () => this._service.clear());
        this._bar.add_child(this._clear);
    }

    _setNoteMode(on) {
        this._noteMode = on;
        this._entry.text = '';
        this._entry.hint_text = on ? 'Write a note, Enter saves it' : 'Search…';
        if (!on)
            this._rebuild();
        if (on)
            this._addNote.add_style_pseudo_class('checked');
        else
            this._addNote.remove_style_pseudo_class('checked');
        this._rebuild();
        this._startTyping();
        this._entry.grab_key_focus();
    }

    _startTyping() {
        if (this._typing)
            return;
        this._typing = true;
        this._ui.beginTextInput(() => this.stopTyping(true));
        this._entry.grab_key_focus();
    }

    _rebuild() {
        this._rebuildNow();
        this.onContentChanged?.();
    }

    /** The scrolling lists of this view (the panel can ask how much they overflow). */
    get scrollTargets() {
        return [{scroll: this._scroll, list: this._list}];
    }

    _rebuildNow() {
        const all = this._service.items;
        const query = this._noteMode ? '' : this._entry.text.trim().toLowerCase();
        const items = all
            .filter(item => !query || item.text.toLowerCase().includes(query))
            .sort((a, b) => Number(!!b.saved) - Number(!!a.saved));
        if (!this._noteMode)
            this._entry.hint_text = all.length === 0 ? 'Search…' : `Search ${all.length} items…`;
        this._clear.visible = this._service.hasUnsaved;
        this._empty.text = all.length === 0 ? 'Copied text shows up here' : 'Nothing found';
        this._empty.visible = items.length === 0;
        this._scroll.visible = items.length > 0;
        this._list.destroy_all_children();
        for (const item of items) {
            this._list.add_child(new ClipRow({
                item,
                onPaste: i => this._onPaste(i),
                onCopy: i => this._service.copy(i.id),
                onPin: i => this._service.togglePin(i.id),
                onRemove: i => this._service.remove(i.id),
            }));
        }
    }
}
