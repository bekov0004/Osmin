import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const MAX_URI_LIST_BYTES = 1024 * 1024;
const BUTTON_MASK = Clutter.ModifierType.BUTTON1_MASK |
    Clutter.ModifierType.BUTTON2_MASK | Clutter.ModifierType.BUTTON3_MASK;

/**
 * Watches drags of FILES that other applications start (X11 and Wayland):
 * the shell cannot be a real drop target, but it is told where the pointer
 * is during a drag and can read what is being dragged.
 *
 *  - 'drag-started' (uris)   a file drag began; its file:// URIs are known
 *  - 'drag-moved' (x, y)     the pointer moved during the drag
 *  - 'drag-ended' ({dropped, uris, x, y})
 *        `dropped` is true when the button was released, false when the drag
 *        was cancelled (Escape: the button is still held when the drag ends).
 *
 * Nothing is accepted from the source, so nothing is copied or moved.
 */
export class DragService extends Signals.EventEmitter {
    constructor() {
        super();
        this._dnd = null;
        this._ids = [];
        this._uris = null;
        this._position = [0, 0];
        this._generation = 0;
        this._cancellable = null;
    }

    get dragging() {
        return this._uris !== null;
    }

    start() {
        this._dnd = global.backend.get_dnd();
        this._ids = [
            this._dnd.connect('dnd-enter', () => this._onEnter()),
            this._dnd.connect('dnd-position-change', (_dnd, x, y) => this._onMove(x, y)),
            this._dnd.connect('dnd-leave', () => this._onLeave()),
        ];
    }

    destroy() {
        this._cancellable?.cancel();
        for (const id of this._ids)
            this._dnd?.disconnect(id);
        this._ids = [];
        this._dnd = null;
        this._uris = null;
    }

    _onEnter() {
        this._uris = null;
        const generation = ++this._generation;
        const selection = global.display.get_selection();
        const mimetypes = selection.get_mimetypes(Meta.SelectionType.SELECTION_DND);
        if (!mimetypes.includes('text/uri-list'))
            return;

        this._cancellable?.cancel();
        this._cancellable = new Gio.Cancellable();
        const output = Gio.MemoryOutputStream.new_resizable();
        selection.transfer_async(Meta.SelectionType.SELECTION_DND, 'text/uri-list',
            MAX_URI_LIST_BYTES, output, this._cancellable, (source, res) => {
                try {
                    source.transfer_finish(res);
                    output.close(null);
                    if (generation !== this._generation)
                        return;
                    const text = new TextDecoder().decode(output.steal_as_bytes().toArray());
                    const uris = text.split(/\r?\n/)
                        .map(line => line.trim())
                        .filter(line => line.startsWith('file://'));
                    if (uris.length === 0)
                        return;
                    this._uris = uris;
                    this.emit('drag-started', uris);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`[osmin] reading dragged files failed: ${e.message}`);
                }
            });
    }

    _onMove(x, y) {
        if (!this._uris)
            return;
        this._position = [x, y];
        this.emit('drag-moved', x, y);
    }

    _onLeave() {
        this._generation++;
        this._cancellable?.cancel();
        const uris = this._uris;
        this._uris = null;
        if (!uris)
            return;
        const [, , modifiers] = global.get_pointer();
        const dropped = (modifiers & BUTTON_MASK) === 0;
        this.emit('drag-ended', {dropped, uris, x: this._position[0], y: this._position[1]});
    }
}
