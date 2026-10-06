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
    constructor(files) {
        super({
            vertical: true,
            style_class: 'osmin-tray',
            x_expand: true,
            y_expand: true,
        });
        this._files = files;
        this._drop = {active: false, zone: null, count: 0};

        const header = new St.BoxLayout({style_class: 'osmin-tray-header'});
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
        this._targetIcon = new St.Icon({
            icon_name: 'folder-download-symbolic',
            style_class: 'osmin-tray-target-icon',
            x_align: Clutter.ActorAlign.START,
        });
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
        btBox.add_child(new St.Icon({
            icon_name: 'bluetooth-active-symbolic',
            style_class: 'osmin-tray-bluetooth-icon',
            x_align: Clutter.ActorAlign.START,
        }));
        btBox.add_child(new St.Label({text: 'Bluetooth', style_class: 'osmin-tray-bluetooth-title'}));
        btBox.add_child(new St.Label({text: 'Send to a device', style_class: 'osmin-tray-target-hint'}));
        this._bluetooth.add_child(btBox);

        const targets = new St.BoxLayout({x_expand: true, y_expand: true, style_class: 'osmin-tray-targets'});
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

    /** The drop target under a stage point (with a margin), or null. */
    zoneAt(x, y, margin = 0) {
        const inside = actor => {
            if (!actor.visible)
                return false;
            const [ax, ay] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            return Number.isFinite(ax) && x >= ax - margin && x <= ax + w + margin &&
                y >= ay - margin && y <= ay + h + margin;
        };
        if (inside(this._bluetooth))
            return 'bluetooth';
        return inside(this._target) ? 'tray' : null;
    }

    _paintOutline(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const armed = this._drop.zone === 'tray' && this._drop.active;
        const r = 18;
        const x = 1.5, y = 1.5, ww = w - 3, hh = h - 3;
        cr.newSubPath();
        cr.arc(x + ww - r, y + r, r, -Math.PI / 2, 0);
        cr.arc(x + ww - r, y + hh - r, r, 0, Math.PI / 2);
        cr.arc(x + r, y + hh - r, r, Math.PI / 2, Math.PI);
        cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
        cr.closePath();
        if (armed) {
            cr.setSourceRGBA(0.22, 0.52, 1.0, 0.16);
            cr.fillPreserve();
        }
        cr.setSourceRGBA(0.24, 0.55, 1.0, armed ? 1.0 : 0.85);
        cr.setLineWidth(2.5);
        cr.setDash([9, 6], 0);
        cr.stroke();
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

        // The target shows when there is nothing in the tray, or while dragging.
        const showTarget = active || count === 0;
        this._target.visible = showTarget;
        this._scroll.visible = count > 0;
        if (showTarget) {
            const files = dragged === 1 ? '1 file' : `${dragged} files`;
            if (active) {
                this._targetTitle.text = 'Files Tray';
                this._targetHint.text = armed ? `Release to add ${files}` : `Drop ${files} here`;
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
        this._outline.queue_repaint();
        // While dragging over a full tray the target covers the files.
        this._targets.opacity = active && count > 0 ? 235 : 255;
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
