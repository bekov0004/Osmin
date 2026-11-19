import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

const HEIGHT = 150;
const PAD = 14;
const MOVE_PX = 4;    // a press that moves less than this is a click (selects the monitor)

/**
 * A small picture of the monitors as they stand. A monitor is chosen by a click and moved by dragging it: where it is
 * let go, it goes flush against the nearest edge of another monitor (arrange.js decides, the owner applies).
 */
export class ArrangeMap extends St.Widget {
    static {
        GObject.registerClass({GTypeName: 'OsminArrangeMap'}, this);
    }

    /**
     * @param {{onSelect: (id: string) => void, onDrop: (id: string, x: number, y: number) => void}} params x, y: where
     *   the dragged monitor's corner was let go, in desktop pixels
     */
    constructor({onSelect, onDrop}) {
        super({style_class: 'osmin-arrange-map', x_expand: true, reactive: false});
        this._onSelect = onSelect;
        this._onDrop = onDrop;
        this._rects = [];
        this._selected = null;
        this._tiles = new Map();
        this._drag = null;
        this._view = {scale: 1, ox: 0, oy: 0};
        this.connect('destroy', () => this._endDrag());
    }

    /** @param {{id, x, y, w, h, primary, names: string[]}[]} rects @param {string|null} selected */
    set(rects, selected) {
        this._endDrag();
        this._rects = rects;
        this._selected = selected;
        for (const tile of this._tiles.values())
            tile.destroy();
        this._tiles.clear();
        rects.forEach((rect, i) => {
            const tile = new St.Widget({
                style_class: 'osmin-arrange-tile', reactive: true, track_hover: true,
                layout_manager: new Clutter.BinLayout(),
            });
            const box = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
            box.add_child(new St.Label({text: String(i + 1), style_class: 'osmin-arrange-number', x_align: Clutter.ActorAlign.CENTER}));
            const name = new St.Label({text: rect.names.join(' + '), style_class: 'osmin-arrange-name', x_align: Clutter.ActorAlign.CENTER});
            name.clutter_text.ellipsize = 3;     // Pango.EllipsizeMode.END
            box.add_child(name);
            if (rect.primary)
                box.add_child(new St.Label({text: 'main', style_class: 'osmin-arrange-main', x_align: Clutter.ActorAlign.CENTER}));
            tile.add_child(box);
            if (rect.id === selected)
                tile.add_style_pseudo_class('checked');
            tile.connect('button-press-event', (_a, event) => this._begin(rect, tile, event));
            tile.connect('motion-event', (_a, event) => this._move(event));
            tile.connect('button-release-event', (_a, event) => this._release(event));
            tile.connect('touch-event', (_a, event) => this._touch(rect, tile, event));
            this.add_child(tile);
            this._tiles.set(rect.id, tile);
        });
        this.queue_relayout();
    }

    vfunc_get_preferred_width(_forHeight) {
        return [0, 0];
    }

    vfunc_get_preferred_height(_forWidth) {
        return [HEIGHT, HEIGHT];
    }

    /** Every monitor where it stands (the dragged one where the pointer has it). */
    vfunc_allocate(box) {
        this.set_allocation(box);
        this._view = this._fit(box.get_width());
        const {scale, ox, oy} = this._view;
        for (const rect of this._rects) {
            const tile = this._tiles.get(rect.id);
            if (!tile)
                continue;
            const w = Math.max(8, Math.round(rect.w * scale) - 2);
            const h = Math.max(8, Math.round(rect.h * scale) - 2);
            const dragged = this._drag?.moved && this._drag.tile === tile;
            const x = dragged ? this._drag.px : Math.round(ox + rect.x * scale);
            const y = dragged ? this._drag.py : Math.round(oy + rect.y * scale);
            const child = new Clutter.ActorBox();
            child.set_origin(x, y);
            child.set_size(w, h);
            tile.allocate(child);
        }
    }

    /** Desktop pixels -> pixels of this picture. */
    _fit(width) {
        const rects = this._rects;
        if (!rects.length)
            return {scale: 1, ox: 0, oy: 0};
        const minX = Math.min(...rects.map(r => r.x));
        const minY = Math.min(...rects.map(r => r.y));
        const w = Math.max(...rects.map(r => r.x + r.w)) - minX;
        const h = Math.max(...rects.map(r => r.y + r.h)) - minY;
        // room around, so a monitor can be dragged to any side
        const scale = Math.min((width - 2 * PAD) / (w * 1.5), (HEIGHT - 2 * PAD) / (h * 1.5));
        return {scale, ox: (width - w * scale) / 2 - minX * scale, oy: (HEIGHT - h * scale) / 2 - minY * scale};
    }

    _begin(rect, tile, event) {
        if (event.get_button() !== 1 || this._drag)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const [tx, ty] = tile.get_position();
        this._drag = {rect, tile, x, y, tx, ty, px: tx, py: ty, moved: false, grab: global.stage.grab(tile)};
        return Clutter.EVENT_STOP;
    }

    _move(event) {
        const drag = this._drag;
        if (!drag)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < MOVE_PX)
            return Clutter.EVENT_STOP;
        if (!drag.moved) {
            drag.moved = true;
            drag.tile.add_style_pseudo_class('active');
            this.set_child_above_sibling(drag.tile, null);
        }
        drag.px = Math.round(drag.tx + x - drag.x);
        drag.py = Math.round(drag.ty + y - drag.y);
        this.queue_relayout();
        return Clutter.EVENT_STOP;
    }

    _release() {
        const drag = this._drag;
        if (!drag)
            return Clutter.EVENT_PROPAGATE;
        this._endDrag();
        if (!drag.moved) {
            this._onSelect(drag.rect.id);
            return Clutter.EVENT_STOP;
        }
        const {scale, ox, oy} = this._view;
        this._onDrop(drag.rect.id, Math.round((drag.px - ox) / scale), Math.round((drag.py - oy) / scale));
        return Clutter.EVENT_STOP;
    }

    _touch(rect, tile, event) {
        switch (event.type()) {
        case Clutter.EventType.TOUCH_BEGIN:
            return this._begin(rect, tile, {get_button: () => 1, get_coords: () => event.get_coords()});
        case Clutter.EventType.TOUCH_UPDATE:
            return this._move(event);
        case Clutter.EventType.TOUCH_END:
        case Clutter.EventType.TOUCH_CANCEL:
            return this._release(event);
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _endDrag() {
        const drag = this._drag;
        if (!drag)
            return;
        this._drag = null;
        drag.grab?.dismiss();
        drag.tile.remove_style_pseudo_class?.('active');
    }

    /** A monitor that could not go where it was let go goes back. */
    settle() {
        this.queue_relayout();
    }
}
