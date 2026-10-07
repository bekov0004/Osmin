import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {FileItem} from './fileItem.js';

/**
 * The Tray: the second mode of the capsule. A row of the files you put aside
 * (they stay until removed), or an invitation to drop files here. While files
 * are being dragged over the capsule it turns into the drop target.
 */
export class TrayView extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminTrayView'}, this);
    }

    /** @param {FileService} files */
    constructor(files, drag = null) {
        super({
            vertical: true,
            style_class: 'osmin-tray',
            x_expand: true,
            y_expand: true,
        });
        this._files = files;
        this._drag = drag;
        this._drop = {active: false, zone: null, count: 0};

        const header = new St.BoxLayout({style_class: 'osmin-tray-header'});
        this._header = header;
        this._caption = new St.Label({
            style_class: 'osmin-tray-caption',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._caption);
        this._clear = new St.Button({label: 'Clear', style_class: 'osmin-tray-clear', can_focus: true});
        this._clear.connect('clicked', () => this._files.clear());
        header.add_child(this._clear);
        this.add_child(header);

        // Files, or the empty / drop invitation, in the same area.
        const area = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this.add_child(area);

        this._scroll = new St.ScrollView({
            style_class: 'osmin-tray-scroll',
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.EXTERNAL, // scrolls with the wheel / swipe, no bar
            vscrollbar_policy: St.PolicyType.NEVER,
        });
        this._row = new St.BoxLayout({style_class: 'osmin-tray-row', y_expand: true});
        this._scroll.add_child(this._row);
        // The wheel scrolls the row sideways.
        this._scroll.connect('scroll-event', (_actor, event) => this._onScroll(event));
        area.add_child(this._scroll);

        // The drop target: a dashed blue outline with the icon and name in its corner.
        this._target = new St.Widget({
            style_class: 'osmin-tray-target',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this._outline = new St.DrawingArea({x_expand: true, y_expand: true});
        this._outline.connect('repaint', area => this._paintOutline(area));
        this._target.add_child(this._outline);
        const targetBox = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-tray-target-box',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // A filled inbox tray, drawn here (no icon in the theme looks like it).
        this._targetIcon = new St.DrawingArea({
            style_class: 'osmin-tray-target-icon',
            x_align: Clutter.ActorAlign.START,
        });
        this._targetIcon.connect('repaint', area => this._paintTrayIcon(area));
        this._targetTitle = new St.Label({style_class: 'osmin-tray-target-title'});
        this._targetHint = new St.Label({style_class: 'osmin-tray-target-hint'});
        targetBox.add_child(this._targetIcon);
        targetBox.add_child(this._targetTitle);
        targetBox.add_child(this._targetHint);
        this._target.add_child(targetBox);

        // Second drop target (like AirDrop on the Mac): send the files by Bluetooth.
        this._bluetooth = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-tray-bluetooth',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            visible: false,
        });
        const btBox = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-tray-target-box',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // The Bluetooth rune, drawn here (the theme's icon is a filled box).
        const rune = new St.DrawingArea({
            style_class: 'osmin-tray-bluetooth-icon',
            x_align: Clutter.ActorAlign.START,
        });
        rune.connect('repaint', area => this._paintRune(area));
        btBox.add_child(rune);
        btBox.add_child(new St.Label({text: 'Bluetooth', style_class: 'osmin-tray-bluetooth-title'}));
        this._bluetooth.add_child(btBox);

        const targets = new St.BoxLayout({x_expand: true, y_expand: true, style_class: 'osmin-tray-targets'});
        targets.layout_manager.homogeneous = true; // both targets are always the same width
        targets.add_child(this._target);
        targets.add_child(this._bluetooth);
        this._targets = targets;
        area.add_child(targets);

        this._files.connectObject('changed', () => this._rebuild(), this);
        this._rebuild();
    }

    destroy() {
        this._files.disconnectObject(this);
        super.destroy();
    }

    /**
     * @param {{active: boolean, zone?: string|null, count?: number}} drop
     *   active: files are being dragged over the capsule; zone: 'tray' or
     *   'bluetooth' while the pointer is over that target (releasing now uses it).
     */
    setDrop({active, zone = null, count = this._drop.count}) {
        this._drop = {active, zone, count};
        this._update();
    }

    /**
     * The drop target under a stage point, or null. A point outside both targets
     * still counts for the nearest one within the margin; a tie goes to the tray.
     */
    zoneAt(x, y, margin = 0) {
        const distance = actor => {
            if (!actor.visible)
                return Infinity;
            const [ax, ay] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            if (!Number.isFinite(ax) || !Number.isFinite(ay))
                return Infinity;
            const dx = Math.max(ax - x, 0, x - (ax + w));
            const dy = Math.max(ay - y, 0, y - (ay + h));
            return Math.max(dx, dy);
        };
        const tray = distance(this._target);
        const bluetooth = distance(this._bluetooth);
        if (Math.min(tray, bluetooth) > margin)
            return null;
        return tray <= bluetooth ? 'tray' : 'bluetooth';
    }

    /**
     * The soft dashed outline of the drop target: round-capped dashes whose
     * length is fitted so the pattern closes seamlessly all the way around.
     */
    _paintOutline(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const armed = this._drop.zone === 'tray' && this._drop.active;
        const width = 2.6;
        const inset = width / 2 + 0.5;
        const x = inset, y = inset, ww = w - 2 * inset, hh = h - 2 * inset;
        const r = Math.min(26, ww / 2, hh / 2);

        const perimeter = 2 * (ww - 2 * r) + 2 * (hh - 2 * r) + 2 * Math.PI * r;
        const count = Math.max(Math.round(perimeter / 19), 8);
        const period = perimeter / count;
        const dash = period * 0.52;
        // Round caps add half the line width at both ends of every dash.
        const on = Math.max(dash - width, 0.1);
        const off = period - on;

        cr.newSubPath();
        cr.arc(x + ww - r, y + r, r, -Math.PI / 2, 0);
        cr.arc(x + ww - r, y + hh - r, r, 0, Math.PI / 2);
        cr.arc(x + r, y + hh - r, r, Math.PI / 2, Math.PI);
        cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
        cr.closePath();
        if (armed) {
            cr.setSourceRGBA(0.24, 0.55, 1.0, 0.12);
            cr.fillPreserve();
        }
        if (armed)
            cr.setSourceRGBA(0.24, 0.55, 1.0, 1.0);
        else
            cr.setSourceRGBA(0.047, 0.353, 0.69, 0.95);
        cr.setLineWidth(width);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        cr.setDash([on, off], 0);
        cr.stroke();
        cr.$dispose();
    }

    _paintRune(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        cr.setSourceRGBA(0.102, 0.482, 1.0, 1.0);
        cr.scale(w / 24, h / 24);
        cr.moveTo(6.5, 7.5);
        cr.lineTo(17, 17);
        cr.lineTo(12, 21.5);
        cr.lineTo(12, 2.5);
        cr.lineTo(17, 7);
        cr.lineTo(6.5, 16.5);
        cr.setLineWidth(1.9);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        cr.stroke();
        cr.$dispose();
    }

    _paintTrayIcon(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const armed = this._drop.zone === 'tray' && this._drop.active;
        if (armed)
            cr.setSourceRGBA(0.24, 0.545, 1.0, 1.0);
        else
            cr.setSourceRGBA(0.075, 0.408, 0.788, 1.0);
        cr.scale(w / 24, h / 24);
        // The open top: a thin outline.
        cr.moveTo(3, 13);
        cr.lineTo(5.9, 5.9);
        cr.curveTo(6.3, 4.9, 6.9, 4.5, 7.9, 4.5);
        cr.lineTo(16.1, 4.5);
        cr.curveTo(17.1, 4.5, 17.7, 4.9, 18.1, 5.9);
        cr.lineTo(21, 13);
        cr.setLineWidth(1.8);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        cr.stroke();
        // The solid lower half with the dip in front.
        cr.moveTo(3, 13);
        cr.lineTo(8, 13);
        cr.curveTo(9.2, 13, 9.7, 13.6, 10.1, 14.4);
        cr.curveTo(10.6, 15.5, 11.2, 15.8, 12, 15.8);
        cr.curveTo(12.8, 15.8, 13.4, 15.5, 13.9, 14.4);
        cr.curveTo(14.3, 13.6, 14.8, 13, 16, 13);
        cr.lineTo(21, 13);
        cr.lineTo(21, 18);
        cr.curveTo(21, 19.8, 20.2, 20.5, 18.5, 20.5);
        cr.lineTo(5.5, 20.5);
        cr.curveTo(3.8, 20.5, 3, 19.8, 3, 18);
        cr.closePath();
        cr.fill();
        cr.$dispose();
    }

    _rebuild() {
        const items = this._files.items;
        this._row.destroy_all_children();
        for (const item of items) {
            this._row.add_child(new FileItem({
                item,
                onOpen: uri => this._files.open(uri),
                onShowInFolder: uri => this._files.showInFolder(uri),
                onCopy: uri => this._files.copyToClipboard([uri]),
                onRemove: uri => this._files.remove(uri),
                drag: this._drag,
            }));
        }
        this._update();
    }

    _update() {
        const count = this._files.items.length;
        const {active, zone, count: dragged} = this._drop;
        const armed = zone === 'tray';
        this._caption.text = count > 0 ? `TRAY · ${count}` : 'TRAY';
        this._clear.visible = count > 0 && !active;
        // While dragging, only the drop targets are shown: no caption, no files.
        this._header.visible = !active;

        // The target shows when there is nothing in the tray, or while dragging.
        const showTarget = active || count === 0;
        this._target.visible = showTarget;
        this._scroll.visible = count > 0 && !active;
        if (showTarget) {
            const files = dragged === 1 ? '1 file' : `${dragged} files`;
            if (active) {
                this._targetTitle.text = 'Files Tray';
                this._targetHint.text = armed ? `Release to add ${files}` : '';
            } else {
                this._targetTitle.text = 'Files Tray';
                this._targetHint.text = 'Drop files here. They stay until you remove them';
            }
        }
        if (armed && active)
            this._target.add_style_pseudo_class('active');
        else
            this._target.remove_style_pseudo_class('active');
        this._bluetooth.visible = active;
        if (zone === 'bluetooth' && active)
            this._bluetooth.add_style_pseudo_class('active');
        else
            this._bluetooth.remove_style_pseudo_class('active');
        this._targetHint.visible = this._targetHint.text !== '';
        this._outline.queue_repaint();
        this._targetIcon.queue_repaint();
    }

    _onScroll(event) {
        const adjustment = this._scroll.hadjustment;
        if (adjustment.upper <= adjustment.page_size)
            return Clutter.EVENT_PROPAGATE;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            adjustment.value -= 70;
            return Clutter.EVENT_STOP;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            adjustment.value += 70;
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
