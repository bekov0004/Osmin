import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {JsonStore} from '../utils/jsonStore.js';

const MAX_LENGTH = 20000;
const MAX_SAVED = 100;
// Password managers mark what they copy with this type: never record it.
const PASSWORD_HINT = 'x-kde-passwordManagerHint';

/**
 * The clipboard history. Text you copy with Ctrl+C is collected (newest
 * first); you can also write your own notes. Pinned items and notes are saved
 * in ~/.local/share/osmin/clipboard.json; the rest of the history is only
 * saved if "keep history" is on, so copied passwords and the like do not end
 * up on disk by default. Nothing is sent anywhere.
 *
 * Items: {id, text, saved, note, at}. `saved`: pinned (kept, never pushed
 * out); `note`: written by the user.
 *
 * Signal: 'changed'.
 */
export class ClipboardService extends Signals.EventEmitter {
    /** @param {{keepHistory: () => boolean, maxItems: () => number}} options */
    constructor({keepHistory = () => false, maxItems = () => 30} = {}) {
        super();
        this._keepHistory = keepHistory;
        this._maxItems = maxItems;
        this._store = new JsonStore('clipboard.json');
        this._items = [];
        this._nextId = 1;
        this._clipboard = St.Clipboard.get_default();
        this._keyboard = null;
        this._timeouts = new Set();
    }

    get items() {
        return this._items;
    }

    /** Loads the saved items and starts watching the clipboard. */
    start() {
        const data = this._store.load();
        if (Array.isArray(data?.items)) {
            this._items = data.items
                .filter(item => item && typeof item.text === 'string' && item.text !== '')
                .map(item => ({
                    id: 0,
                    text: item.text.slice(0, MAX_LENGTH),
                    saved: item.saved === true,
                    note: item.note === true,
                    at: Number(item.at) || 0,
                }));
            this._items.forEach(item => {
                item.id = this._nextId++;
            });
        }
        this.emit('changed');

        global.display.get_selection().connectObject('owner-changed', (_sel, type) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._read();
        }, this);
        this._read();
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
        this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => {
            if (typeof text === 'string')
                this.add(text);
        });
    }

    /** Records copied text (moves it to the top if it is already there). */
    add(text) {
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
            this._items.unshift({id: this._nextId++, text, saved: false, note: false, at: Date.now()});
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
        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, item.text);
        // Putting it back makes it the newest again.
        this.add(item.text);
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
        const keep = this._keepHistory();
        this._store.save({
            version: 1,
            items: this._items
                .filter(item => keep || item.saved)
                .map(({text, saved, note, at}) => ({text, saved, note, at})),
        });
    }
}
