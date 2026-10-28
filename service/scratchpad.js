import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {JsonStore} from './lib/jsonStore.js';

const SAVE_DELAY_MS = 500;
const MAX_NOTES = 200;

const titleOf = text => (text.split('\n').find(line => line.trim()) ?? 'New note').replace(/^#+\s*/, '').trim().slice(0, 60) || 'New note';

/**
 * The Scratchpad: a window of notes of any length, one per tab-like entry in the list. Everything
 * is saved as you type (~/.local/share/osmin/scratchpad.json); "Export" writes the note as a
 * Markdown file. Opened from the Search tab ("scratchpad") or the app menu.
 */
export function createScratchpad() {
    GLib.set_prgname('io.github.bekov0004.Osmin');
    Adw.init();

    const store = new JsonStore('scratchpad.json');
    const saved = store.load();
    let notes = Array.isArray(saved?.notes) ? saved.notes.filter(n => n && typeof n.text === 'string').slice(0, MAX_NOTES) : [];
    let selected = notes.length > 0 ? 0 : -1;
    let saveId = 0;
    let loading = false;

    const save = () => {
        if (saveId)
            GLib.source_remove(saveId);
        saveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DELAY_MS, () => {
            saveId = 0;
            store.save({version: 1, notes});
            return GLib.SOURCE_REMOVE;
        });
    };

    const window = new Adw.Window({title: 'Osmin Scratchpad', default_width: 760, default_height: 520});
    const toolbar = new Adw.ToolbarView();
    const header = new Adw.HeaderBar();
    const add = new Gtk.Button({icon_name: 'list-add-symbolic', tooltip_text: 'New note'});
    const remove = new Gtk.Button({icon_name: 'user-trash-symbolic', tooltip_text: 'Delete this note'});
    const exportButton = new Gtk.Button({icon_name: 'document-save-symbolic', tooltip_text: 'Export as Markdown'});
    header.pack_start(add);
    header.pack_end(exportButton);
    header.pack_end(remove);
    toolbar.add_top_bar(header);

    const body = new Gtk.Paned({orientation: Gtk.Orientation.HORIZONTAL, position: 220, shrink_start_child: false, shrink_end_child: false});
    const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.SINGLE, css_classes: ['navigation-sidebar']});
    const sidebar = new Gtk.ScrolledWindow({child: list, hscrollbar_policy: Gtk.PolicyType.NEVER, width_request: 180});
    const view = new Gtk.TextView({wrap_mode: Gtk.WrapMode.WORD_CHAR, left_margin: 14, right_margin: 14, top_margin: 12, bottom_margin: 12, monospace: false});
    const editor = new Gtk.ScrolledWindow({child: view, hexpand: true, vexpand: true});
    body.set_start_child(sidebar);
    body.set_end_child(editor);
    toolbar.set_content(body);
    window.set_content(toolbar);

    const buffer = view.get_buffer();

    const rebuild = () => {
        let child;
        while ((child = list.get_first_child()))
            list.remove(child);
        notes.forEach(note => {
            const row = new Gtk.ListBoxRow();
            row.set_child(new Gtk.Label({label: titleOf(note.text), xalign: 0, ellipsize: 3, margin_top: 8, margin_bottom: 8, margin_start: 10, margin_end: 10}));
            list.append(row);
        });
        if (selected >= 0 && selected < notes.length)
            list.select_row(list.get_row_at_index(selected));
    };

    const show = () => {
        loading = true;
        buffer.set_text(selected >= 0 ? notes[selected].text : '', -1);
        loading = false;
        view.set_sensitive(selected >= 0);
        remove.set_sensitive(selected >= 0);
        exportButton.set_sensitive(selected >= 0);
    };

    list.connect('row-selected', (_list, row) => {
        if (!row || loading)
            return;
        selected = row.get_index();
        show();
    });
    buffer.connect('changed', () => {
        if (loading || selected < 0)
            return;
        const [start, end] = buffer.get_bounds();
        notes[selected].text = buffer.get_text(start, end, false);
        notes[selected].at = Date.now();
        // The title in the list follows the first line.
        const label = list.get_row_at_index(selected)?.get_child();
        if (label)
            label.label = titleOf(notes[selected].text);
        save();
    });
    add.connect('clicked', () => {
        notes.unshift({text: '', at: Date.now()});
        notes = notes.slice(0, MAX_NOTES);
        selected = 0;
        rebuild();
        show();
        view.grab_focus();
        save();
    });
    remove.connect('clicked', () => {
        if (selected < 0)
            return;
        notes.splice(selected, 1);
        selected = Math.min(selected, notes.length - 1);
        rebuild();
        show();
        save();
    });
    exportButton.connect('clicked', () => {
        if (selected < 0)
            return;
        const dialog = new Gtk.FileDialog({title: 'Export note', initial_name: `${titleOf(notes[selected].text).replace(/[\\/:*?"<>|]/g, '_')}.md`});
        dialog.save(window, null, (_d, result) => {
            try {
                const file = dialog.save_finish(result);
                file.replace_contents(new TextEncoder().encode(notes[selected].text), null, false, Gio.FileCreateFlags.NONE, null);
            } catch (e) {
                // cancelled
            }
        });
    });
    window.connect('close-request', () => {
        if (saveId) {
            GLib.source_remove(saveId);
            saveId = 0;
        }
        store.save({version: 1, notes});
        return false;
    });

    if (notes.length === 0) {
        notes.push({text: '', at: Date.now()});
        selected = 0;
    }
    rebuild();
    show();
    window.api = {notes: () => notes};
    return window;
}
