import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

const MOVE_PX = 4;        // a press that moves less than this is a click
const EDGE = 0.1;         // let go this near an edge of the screen (a share of its size): the window takes a zone

/**
 * Where a window let go at u, v (0..1 across the screen, the pointer) goes: a zone of the screen, or null (it stays where
 * it was let go). @returns {{id, x, y, w, h}|null} x, y, w, h as shares of the work area
 */
export function zoneAt(u, v) {
    const left = u < EDGE;
    const right = u > 1 - EDGE;
    const top = v < EDGE;
    const bottom = v > 1 - EDGE;
    if (top && left)
        return {id: 'top-left', x: 0, y: 0, w: 0.5, h: 0.5};
    if (top && right)
        return {id: 'top-right', x: 0.5, y: 0, w: 0.5, h: 0.5};
    if (bottom && left)
        return {id: 'bottom-left', x: 0, y: 0.5, w: 0.5, h: 0.5};
    if (bottom && right)
        return {id: 'bottom-right', x: 0.5, y: 0.5, w: 0.5, h: 0.5};
    if (left)
        return {id: 'left', x: 0, y: 0, w: 0.5, h: 1};
    if (right)
        return {id: 'right', x: 0.5, y: 0, w: 0.5, h: 1};
    if (top)
        return {id: 'maximize', x: 0, y: 0, w: 1, h: 1};
    if (bottom)
        return {id: 'bottom', x: 0, y: 0.5, w: 1, h: 0.5};
    return null;
}

/**
 * A picture of one screen with its windows, each a live miniature: drag one to move the window (let go at an edge: it
 * takes that half or quarter, at the top: the whole screen), let go over a desktop's tab or a monitor to send it there,
 * click to bring it forward, ✕ to close it.
 */
export class WindowMap extends St.Widget {
    static {
        GObject.registerClass({GTypeName: 'OsminWindowMap'}, this);
    }

    /**
     * @param {{onRaise, onClose, onMove, onDropOutside, onDragging}} handlers
     *   onRaise(window), onClose(window), onMove(window, {zone, x, y}) x, y: the new corner as shares of the work area,
     *   onDropOutside(window, stageX, stageY) -> whether something outside took it, onDragging(window|null)
     */
    constructor(handlers) {
        super({style_class: 'osmin-winmap', x_expand: true, reactive: true, clip_to_allocation: true});
        this._handlers = handlers;
        this._area = {x: 0, y: 0, width: 16, height: 9};
        this._items = [];        // {window, tile, x, y, w, h} (shares of the work area)
        this._drag = null;
        this._zone = new St.Widget({style_class: 'osmin-winmap-zone', visible: false});
        this.add_child(this._zone);
        this._empty = new St.Label({text: 'No windows here', style_class: 'osmin-winmap-empty', visible: false});
        this.add_child(this._empty);
        this.connect('destroy', () => this._endDrag());
    }

    get dragging() {
        return !!this._drag?.moved;
    }

    /** @param {{x, y, width, height}} area the work area shown @param {Meta.Window[]} windows bottom to top */
    set(area, windows) {
        this._endDrag();
        this._area = area;
        for (const item of this._items)
            item.tile.destroy();
        this._items = [];
        for (const window of windows) {
            const rect = window.get_frame_rect();
            const item = {
                window,
                x: (rect.x - area.x) / area.width, y: (rect.y - area.y) / area.height,
                w: rect.width / area.width, h: rect.height / area.height,
            };
            item.tile = this._tile(item);
            this.add_child(item.tile);
            this._items.push(item);
        }
        this.set_child_above_sibling(this._zone, null);
        this._empty.visible = windows.length === 0;
        this.queue_relayout();
    }

    _tile(item) {
        const {window} = item;
        const tile = new St.Widget({style_class: 'osmin-winmap-window', reactive: true, track_hover: true, layout_manager: new Clutter.BinLayout()});
        const actor = window.get_compositor_private();
        if (actor) {
            // the frame is what moves: the shadow around it is left out
            const holder = new St.Widget({x_expand: true, y_expand: true, clip_to_allocation: true});
            const clone = new Clutter.Clone({source: actor});
            holder.add_child(clone);
            holder.connect('notify::size', () => this._fitClone(holder, clone, actor, window));
            tile.add_child(holder);
        }
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const badge = new St.BoxLayout({style_class: 'osmin-winmap-badge', x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.END});
        if (app)
            badge.add_child(app.create_icon_texture(14));
        const title = new St.Label({text: window.get_title() ?? '', style_class: 'osmin-winmap-title', y_align: Clutter.ActorAlign.CENTER});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        badge.add_child(title);
        tile.add_child(badge);
        const close = new St.Button({style_class: 'osmin-winmap-close', x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START, opacity: 0,
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 10})});
        close.connect('clicked', () => this._handlers.onClose(window));
        tile.add_child(close);
        tile.connect('notify::hover', () => (close.opacity = tile.hover ? 255 : 0));
        tile.connect('button-press-event', (_a, event) => this._begin(item, event));
        tile.connect('motion-event', (_a, event) => this._move(event));
        tile.connect('button-release-event', (_a, event) => this._release(event));
        if (window.minimized)
            tile.add_style_pseudo_class('minimized');
        return tile;
    }

    /** The clone shows the window's actor, shadow and all: it is shifted and scaled so the frame fills the tile. */
    _fitClone(tile, clone, actor, window) {
        const frame = window.get_frame_rect();
        const buffer = window.get_buffer_rect();
        if (frame.width < 1 || frame.height < 1 || tile.width < 1)
            return;
        const sx = tile.width / frame.width;
        const sy = tile.height / frame.height;
        const [aw, ah] = actor.get_size();
        clone.set_scale(sx, sy);
        clone.set_size(aw || buffer.width, ah || buffer.height);
        clone.set_position(Math.round((buffer.x - frame.x) * sx), Math.round((buffer.y - frame.y) * sy));
    }

    vfunc_get_preferred_width(_forHeight) {
        return [0, 0];
    }

    vfunc_get_preferred_height(forWidth) {
        const width = forWidth > 0 ? forWidth : 280;
        const h = Math.round(width * this._area.height / Math.max(1, this._area.width));
        return [h, h];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
        const W = box.get_width();
        const H = box.get_height();
        for (const item of this._items) {
            const dragged = this._drag?.moved && this._drag.item === item;
            const x = dragged ? this._drag.px : Math.round(item.x * W);
            const y = dragged ? this._drag.py : Math.round(item.y * H);
            const child = new Clutter.ActorBox();
            child.set_origin(x, y);
            child.set_size(Math.max(12, Math.round(item.w * W)), Math.max(10, Math.round(item.h * H)));
            item.tile.allocate(child);
        }
        const zone = this._drag?.zone;
        if (zone) {
            const child = new Clutter.ActorBox();
            child.set_origin(Math.round(zone.x * W) + 2, Math.round(zone.y * H) + 2);
            child.set_size(Math.round(zone.w * W) - 4, Math.round(zone.h * H) - 4);
            this._zone.allocate(child);
        } else {
            this._zone.allocate(new Clutter.ActorBox());
        }
        const [, ew] = this._empty.get_preferred_width(-1);
        const [, eh] = this._empty.get_preferred_height(ew);
        const empty = new Clutter.ActorBox();
        empty.set_origin(Math.round((W - ew) / 2), Math.round((H - eh) / 2));
        empty.set_size(ew, eh);
        this._empty.allocate(empty);
    }

    _begin(item, event) {
        if (event.get_button() !== 1 || this._drag)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const [tx, ty] = item.tile.get_position();
        this._drag = {item, x, y, tx, ty, px: tx, py: ty, moved: false, zone: null, grab: global.stage.grab(item.tile)};
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
            drag.item.tile.add_style_pseudo_class('active');
            this.set_child_above_sibling(drag.item.tile, this._zone);
            this._handlers.onDragging?.(drag.item.window);
        }
        drag.px = Math.round(drag.tx + x - drag.x);
        drag.py = Math.round(drag.ty + y - drag.y);
        const inside = this._shares(x, y);
        drag.zone = inside ? zoneAt(inside.u, inside.v) : null;
        this._zone.visible = !!drag.zone;
        this.queue_relayout();
        return Clutter.EVENT_STOP;
    }

    /** The pointer as shares of the picture, or null when it is outside it. */
    _shares(stageX, stageY) {
        const [ok, lx, ly] = this.transform_stage_point(stageX, stageY);
        if (!ok || lx < 0 || ly < 0 || lx > this.width || ly > this.height)
            return null;
        return {u: lx / Math.max(1, this.width), v: ly / Math.max(1, this.height)};
    }

    _release(event) {
        const drag = this._drag;
        if (!drag)
            return Clutter.EVENT_PROPAGATE;
        this._endDrag();
        const {window} = drag.item;
        if (!drag.moved) {
            this._handlers.onRaise(window);
            return Clutter.EVENT_STOP;
        }
        const [x, y] = event.get_coords();
        if (!this._shares(x, y) && this._handlers.onDropOutside(window, x, y)) {
            this.queue_relayout();
            return Clutter.EVENT_STOP;
        }
        this._handlers.onMove(window, {
            zone: drag.zone,
            x: drag.px / Math.max(1, this.width),
            y: drag.py / Math.max(1, this.height),
        });
        this.queue_relayout();
        return Clutter.EVENT_STOP;
    }

    _endDrag() {
        const drag = this._drag;
        if (!drag)
            return;
        this._drag = null;
        drag.grab?.dismiss();
        drag.item.tile.remove_style_pseudo_class?.('active');
        this._zone.visible = false;
        if (drag.moved)
            this._handlers.onDragging?.(null);
    }
}
