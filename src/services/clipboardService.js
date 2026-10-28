import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';


const MAX_LENGTH = 20000;
const MAX_SAVED = 100;
// Password managers mark what they copy with this type: never record it.
const PASSWORD_HINT = 'x-kde-passwordManagerHint';
// Copied files: the file manager's own type, and the common one.
const FILES_TYPE = 'x-special/gnome-copied-files';
const URI_LIST_TYPE = 'text/uri-list';
// Where a file item is pasted as a file manager's file / as a path; anywhere else as a uri list.
const FILE_MANAGERS = /nautilus|nemo|thunar|caja|pcmanfm|dolphin|files/i;
const TEXT_APPS = /terminal|console|konsole|xterm|alacritty|kitty|tilix|gedit|text-editor|kate|code|sublime|emacs|vim|idea|studio/i;

/** The file:// uris in the content of a copied-files / uri-list clipboard type. */
function parseFileUris(bytes) {
    if (!bytes)
        return [];
    const text = new TextDecoder().decode(bytes.get_data());
    return text.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('file://'));
}

const uriToPath = uri => Gio.File.new_for_uri(uri).get_path() ?? uri;

/**
 * The clipboard history. Text you copy with Ctrl+C is collected (newest
 * first); you can also write your own notes. Pinned items and notes are saved
 * in ~/.local/share/osmin/clipboard.json; the rest of the history is only
 * saved if "keep history" is on, so copied passwords and the like do not end
 * up on disk by default. Nothing is sent anywhere.
 *
 * Copied files are recorded too ({text: their paths, files: [uris]}); putting such an item
 * back offers the files, so a file manager or a chat pastes the file, not its path.
 *
 * Items: {id, text, files?, saved, note, at}. `saved`: pinned (kept, never pushed
 * out); `note`: written by the user.
 *
 * Signal: 'changed'.
 */
export class ClipboardService extends Signals.EventEmitter {
    /**
     * @param {ModuleClient} module the Osmin service keeps the history on disk
     * @param {{keepHistory: () => boolean, maxItems: () => number}} options
     */
    constructor(module, {keepHistory = () => false, maxItems = () => 30} = {}) {
        super();
        this._module = module;
        this._loaded = false; // nothing is saved before the saved items were read (it would erase them)
        this._keepHistory = keepHistory;
        this._maxItems = maxItems;
        this._items = [];
        this._nextId = 1;
        this._clipboard = St.Clipboard.get_default();
        this._keyboard = null;
        this._timeouts = new Set();
    }

    get items() {
        return this._items;
    }

    /** Starts watching the clipboard and reads the saved items (from the service) next to what is copied meanwhile. */
    start() {
        global.display.get_selection().connectObject('owner-changed', (_sel, type) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._read();
        }, this);
        this._read();
        this._loadSaved();
    }

    async _loadSaved() {
        let data;
        try {
            data = await this._module.call('load');
        } catch (e) {
            console.warn(`[osmin] the saved clipboard items are not available: ${e.message}`);
            return;
        }
        const saved = (Array.isArray(data?.items) ? data.items : [])
            .filter(item => item && typeof item.text === 'string' && item.text !== '')
            .map(item => ({
                id: 0,
                text: item.text.slice(0, MAX_LENGTH),
                files: Array.isArray(item.files) && item.files.every(u => typeof u === 'string') ? item.files : null,
                saved: item.saved === true,
                note: item.note === true,
                at: Number(item.at) || 0,
            }))
            // what was copied while they were loading is newer and already in the list
            .filter(item => !this._items.some(own => own.text === item.text));
        this._items = [...this._items, ...saved];
        this._items.forEach(item => {
            if (!item.id)
                item.id = this._nextId++;
        });
        this._loaded = true;
        this._trim();
        this._changed();
    }

    destroy() {
        global.display.get_selection().disconnectObject(this);
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        this._keyboard = null;
    }

    _read() {
        const mimetypes = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD) ?? [];
        if (mimetypes.includes(PASSWORD_HINT))
            return;
        const type = [FILES_TYPE, URI_LIST_TYPE].find(t => mimetypes.includes(t));
        const readText = () => this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => {
            if (typeof text === 'string')
                this.add(text);
        });
        if (!type) {
            readText();
            return;
        }
        this._clipboard.get_content(St.ClipboardType.CLIPBOARD, type, (_clipboard, bytes) => {
            const uris = parseFileUris(bytes);
            if (uris.length === 0)
                readText();
            else
                this.add(uris.map(uriToPath).join('\n'), uris);
        });
    }

    /** Records copied text (moves it to the top if it is already there). */
    add(text, files = null) {
        if (text.trim() === '')
            return;
        text = text.slice(0, MAX_LENGTH);
        const existing = this._items.findIndex(item => item.text === text);
        if (existing === 0) {
            return;
        } else if (existing > 0) {
            const [item] = this._items.splice(existing, 1);
            item.at = Date.now();
            this._items.unshift(item);
        } else {
            this._items.unshift({id: this._nextId++, text, files, saved: false, note: false, at: Date.now()});
        }
        this._trim();
        this._changed();
    }

    /** A note written by the user: saved from the start. */
    addNote(text) {
        text = text.trim().slice(0, MAX_LENGTH);
        if (!text)
            return false;
        const existing = this._items.findIndex(item => item.text === text);
        if (existing >= 0) {
            const [item] = this._items.splice(existing, 1);
            item.saved = true;
            item.note = true;
            item.at = Date.now();
            this._items.unshift(item);
        } else {
            this._items.unshift({id: this._nextId++, text, saved: true, note: true, at: Date.now()});
        }
        this._trim();
        this._changed();
        return true;
    }

    remove(id) {
        const index = this._items.findIndex(item => item.id === id);
        if (index < 0)
            return;
        this._items.splice(index, 1);
        this._changed();
    }

    togglePin(id) {
        const item = this._items.find(i => i.id === id);
        if (!item)
            return;
        item.saved = !item.saved;
        this._changed();
    }

    /** Removes everything that is not pinned. */
    clear() {
        this._items = this._items.filter(item => item.saved);
        this._changed();
    }

    get hasUnsaved() {
        return this._items.some(item => !item.saved);
    }

    /** Puts the text of an item on the clipboard. */
    copy(id) {
        const item = this._items.find(i => i.id === id);
        if (!item)
            return;
        const files = item.files?.filter(uri => Gio.File.new_for_uri(uri).query_exists(null));
        if (files?.length) {
            // The file manager takes its own type; browsers and chats the uri list; text apps the path.
            const app = global.display.focus_window?.get_wm_class() ?? '';
            if (TEXT_APPS.test(app) && !FILE_MANAGERS.test(app))
                this._clipboard.set_text(St.ClipboardType.CLIPBOARD, item.text);
            else if (FILE_MANAGERS.test(app))
                this._setContent(FILES_TYPE, `copy\n${files.join('\n')}`);
            else
                this._setContent(URI_LIST_TYPE, `${files.join('\r\n')}\r\n`);
        } else {
            this._clipboard.set_text(St.ClipboardType.CLIPBOARD, item.text);
        }
        // Putting it back makes it the newest again.
        this.add(item.text, item.files);
    }

    _setContent(mimetype, text) {
        this._clipboard.set_content(St.ClipboardType.CLIPBOARD, mimetype,
            new GLib.Bytes(new TextEncoder().encode(text)));
    }

    /** Presses Ctrl+V in whatever has the keyboard focus. */
    sendPaste(delayMs = 180) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._timeouts.delete(id);
            this._pressCtrlV();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }

    _pressCtrlV() {
        try {
            if (!this._keyboard) {
                const seat = global.stage.context.get_backend().get_default_seat();
                this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            }
            const now = () => GLib.get_monotonic_time();
            const {PRESSED, RELEASED} = Clutter.KeyState;
            this._keyboard.notify_keyval(now(), Clutter.KEY_Control_L, PRESSED);
            this._keyboard.notify_keyval(now(), Clutter.KEY_v, PRESSED);
            this._keyboard.notify_keyval(now(), Clutter.KEY_v, RELEASED);
            this._keyboard.notify_keyval(now(), Clutter.KEY_Control_L, RELEASED);
        } catch (e) {
            console.warn(`[osmin] could not paste: ${e.message}`);
        }
    }

    /** Pushes the oldest unpinned items out. */
    _trim() {
        const max = Math.max(5, this._maxItems());
        let unsaved = 0;
        this._items = this._items.filter(item => {
            if (item.saved)
                return true;
            return ++unsaved <= max;
        });
        const saved = this._items.filter(item => item.saved);
        if (saved.length > MAX_SAVED) {
            const drop = new Set(saved.slice(MAX_SAVED));
            this._items = this._items.filter(item => !drop.has(item));
        }
    }

    _changed() {
        this._persist();
        this.emit('changed');
    }

    _persist() {
        if (!this._loaded)
            return;
        const keep = this._keepHistory();
        const items = this._items
            .filter(item => keep || item.saved)
            .map(({text, files, saved, note, at}) => ({text, files, saved, note, at}));
        this._module.call('save', {items}).catch(e => console.warn(`[osmin] saving the clipboard items failed: ${e.message}`));
    }
}
