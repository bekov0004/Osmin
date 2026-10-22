import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {createButton} from '../ui/button.js';
import {scaled} from '../utils/scale.js';

const BAR_WIDTH = 300;

const DEVICE_ICONS = {
    mobile: 'phone-symbolic',
    desktop: 'computer-symbolic',
    web: 'web-browser-symbolic',
    headless: 'utilities-terminal-symbolic',
    server: 'network-server-symbolic',
};

const sizeText = bytes => {
    if (bytes < 1024 * 1024)
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    if (bytes < 1024 ** 3)
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

/** A row that scrolls sideways with the wheel / a swipe, without a scroll bar (like the Tray's). */
function createSideScroll(content) {
    const scroll = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.EXTERNAL,
        vscrollbar_policy: St.PolicyType.NEVER,
        overlay_scrollbars: true,
        x_expand: true,
    });
    scroll.add_child(content);
    scroll.connect('scroll-event', (_actor, event) => {
        const adjustment = scroll.hadjustment;
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
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    });
    return scroll;
}

/**
 * The LocalSend section of the panel, built like the Tray: a row of chips for the files that wait
 * to be sent, and below it a row of tiles for the devices on the network (a click sends). While a
 * transfer runs the devices row shows its progress. Receiving is switched on and off at the end of
 * the "Send to" line.
 */
export class LocalSendView extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminLocalSendView'}, this);
    }

    /** @param {{session: LocalSendSession, getTrayUris: () => string[], receiving: {get: () => boolean, set: (on: boolean) => void}}} params */
    constructor({session, getTrayUris, receiving}) {
        super({vertical: true, style_class: 'osmin-lsv', x_expand: true, y_expand: true});
        this._session = session;
        this._getTrayUris = getTrayUris;
        this._receiving = receiving;

        session.connectObject('changed', () => this._render(), this);
        this.connect('notify::mapped', () => {
            if (this.mapped)
                session.refresh();
        });
        this.connect('destroy', () => session.disconnectObject(this));
        this._render();
    }

    /** Nothing here scrolls up and down: the panel keeps its height. */
    get scrollTargets() {
        return [];
    }

    _render() {
        this.destroy_all_children();
        this._buildFiles();
        this._buildDevices();
        this.onContentChanged?.();
    }

    /** "CAPTION" on the left, small text buttons on the right. */
    _caption(text, actions = []) {
        const row = new St.BoxLayout({style_class: 'osmin-lsv-caption'});
        row.add_child(new St.Label({text, style_class: 'osmin-lsv-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        for (const action of actions) {
            const button = new St.Button({
                label: action.label,
                style_class: `osmin-tray-clear${action.active ? ' osmin-lsv-on' : ''}`,
                can_focus: true,
            });
            button.connect('clicked', () => action.onClick());
            row.add_child(button);
        }
        return row;
    }

    // --- files ----------------------------------------------------------------

    _buildFiles() {
        const files = this._session.basket;
        let total = 0;
        const chips = new St.BoxLayout({style_class: 'osmin-lsv-chips', y_align: Clutter.ActorAlign.CENTER});
        for (const uri of files) {
            const file = Gio.File.new_for_uri(uri);
            let size = 0;
            let icon = null;
            try {
                const info = file.query_info('standard::size,standard::symbolic-icon', Gio.FileQueryInfoFlags.NONE, null);
                size = info.get_size();
                icon = info.get_symbolic_icon();
            } catch (e) {
                // gone since it was added: skipped when sending
            }
            total += size;
            const chip = new St.BoxLayout({style_class: 'osmin-lsv-chip', y_align: Clutter.ActorAlign.CENTER});
            const image = new St.Icon({icon_name: 'text-x-generic-symbolic', style_class: 'osmin-lsv-chip-icon', y_align: Clutter.ActorAlign.CENTER});
            if (icon)
                image.gicon = icon;
            chip.add_child(image);
            const name = new St.Label({text: file.get_basename(), style_class: 'osmin-lsv-chip-name', y_align: Clutter.ActorAlign.CENTER});
            name.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
            chip.add_child(name);
            chip.add_child(new St.Label({text: sizeText(size), style_class: 'osmin-lsv-chip-size', y_align: Clutter.ActorAlign.CENTER}));
            const remove = createButton({
                iconName: 'window-close-symbolic',
                styleClass: 'osmin-ls-file-remove',
                onClick: () => this._session.remove([uri]),
            });
            remove.y_align = Clutter.ActorAlign.CENTER;
            chip.add_child(remove);
            chips.add_child(chip);
        }

        const title = files.length === 0 ? 'FILES' : `FILES · ${files.length} · ${sizeText(total)}`;
        this.add_child(this._caption(title, [
            {label: 'Add from Tray', onClick: () => this._session.offer(this._getTrayUris())},
            ...(files.length > 0 ? [{label: 'Clear', onClick: () => this._session.remove([...files])}] : []),
        ]));
        if (files.length === 0) {
            this.add_child(new St.Label({
                text: 'Drop files on the capsule, or add them from the Tray',
                style_class: 'osmin-lsv-hint',
                y_align: Clutter.ActorAlign.CENTER,
                y_expand: true,
            }));
            return;
        }
        this.add_child(createSideScroll(chips));
    }

    // --- devices / transfer -----------------------------------------------------

    _buildDevices() {
        const s = this._session;
        const receiving = this._receiving.get();
        const receive = {
            label: receiving ? 'Receiving: on' : 'Receiving: off',
            active: receiving,
            onClick: () => {
                this._receiving.set(!this._receiving.get());
                this._render();
            },
        };
        switch (s.phase) {
        case 'waiting':
        case 'sending':
            this.add_child(this._caption(`SENDING TO ${(s.device?.alias ?? '').toUpperCase()}`));
            this.add_child(this._createProgress());
            return;
        case 'done':
            this.add_child(this._caption('DONE'));
            this.add_child(this._createNote('emblem-ok-symbolic', s.message, {label: 'OK', onClick: () => s.refresh()}));
            return;
        case 'error':
            this.add_child(this._caption('LOCALSEND'));
            this.add_child(this._createNote('dialog-warning-symbolic', s.message, {label: 'Try again', onClick: () => s.refresh({force: true})}));
            return;
        default:
            this.add_child(this._caption(s.phase === 'scan' ? 'LOOKING FOR DEVICES…' : 'SEND TO', [
                {label: 'Refresh', onClick: () => s.refresh({force: true})},
                receive,
            ]));
            this.add_child(this._createDevices());
        }
    }

    _createDevices() {
        const s = this._session;
        if (s.devices.length === 0) {
            return new St.Label({
                text: s.phase === 'scan' ? 'Open LocalSend on the other device (same network)' : 'No devices found',
                style_class: 'osmin-lsv-hint',
                y_align: Clutter.ActorAlign.CENTER,
                y_expand: true,
            });
        }
        const tiles = new St.BoxLayout({style_class: 'osmin-lsv-tiles', y_align: Clutter.ActorAlign.CENTER});
        const empty = s.basket.length === 0;
        for (const device of s.devices) {
            const tile = new St.Button({
                style_class: 'osmin-lsv-tile',
                can_focus: true,
                reactive: !empty,
                opacity: empty ? 110 : 255,
            });
            const box = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER});
            const badge = new St.Bin({style_class: 'osmin-lsv-badge', y_align: Clutter.ActorAlign.CENTER});
            badge.set_child(new St.Icon({icon_name: DEVICE_ICONS[device.deviceType] ?? 'computer-symbolic', style_class: 'osmin-lsv-badge-icon'}));
            box.add_child(badge);
            const texts = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'osmin-lsv-tile-texts'});
            const name = new St.Label({text: device.alias, style_class: 'osmin-ls-device-name'});
            name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            texts.add_child(name);
            texts.add_child(new St.Label({text: device.deviceModel || 'LocalSend', style_class: 'osmin-ls-device-model'}));
            box.add_child(texts);
            tile.set_child(box);
            tile.connect('clicked', () => s.sendTo(device));
            tiles.add_child(tile);
        }
        return createSideScroll(tiles);
    }

    _createProgress() {
        const s = this._session;
        const box = new St.BoxLayout({style_class: 'osmin-ls-progress', x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const column = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'osmin-ls-progress'});
        column.add_child(new St.Label({
            text: s.phase === 'waiting' ? `Waiting for ${s.device?.alias ?? 'the device'} to accept…` : `${sizeText(s.sent)} of ${sizeText(s.total)}`,
            style_class: 'osmin-ls-status',
        }));
        const track = new St.Widget({style_class: 'osmin-ls-bar', width: scaled(BAR_WIDTH), x_align: Clutter.ActorAlign.START});
        const fill = new St.Widget({
            style_class: 'osmin-ls-bar-fill',
            width: scaled(BAR_WIDTH) * (s.total > 0 ? s.sent / s.total : 0),
            x_align: Clutter.ActorAlign.START,
        });
        const stack = new St.Widget({layout_manager: new Clutter.BinLayout()});
        stack.add_child(track);
        stack.add_child(fill);
        column.add_child(stack);
        box.add_child(column);
        const cancel = createButton({label: 'Cancel', styleClass: 'osmin-ls-cancel', onClick: () => s.cancel()});
        cancel.y_align = Clutter.ActorAlign.CENTER;
        box.add_child(cancel);
        return box;
    }

    _createNote(iconName, text, action = null) {
        const box = new St.BoxLayout({x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'osmin-ls-note'});
        box.add_child(new St.Icon({icon_name: iconName, style_class: 'osmin-ls-note-icon', y_align: Clutter.ActorAlign.CENTER}));
        box.add_child(new St.Label({text, style_class: 'osmin-ls-status', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        if (action) {
            const button = createButton({label: action.label, styleClass: 'osmin-ls-cancel', onClick: action.onClick});
            button.y_align = Clutter.ActorAlign.CENTER;
            box.add_child(button);
        }
        return box;
    }

    destroy() {
        this._session.disconnectObject(this);
        super.destroy();
    }
}
