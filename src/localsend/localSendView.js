import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {createButton} from '../ui/button.js';
import {scaled} from '../utils/scale.js';

const BAR_WIDTH = 150;

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

/**
 * The LocalSend section of the panel: on the left the files waiting to be sent, on the right the
 * devices on the network (a click sends), or the transfer. Receiving can be switched on at the
 * bottom of the right column.
 */
export class LocalSendView extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminLocalSendView'}, this);
    }

    /** @param {{session: LocalSendSession, getTrayUris: () => string[], receiving: {get: () => boolean, set: (on: boolean) => void}}} params */
    constructor({session, getTrayUris, receiving}) {
        super({style_class: 'osmin-lsv', x_expand: true, y_expand: true});
        this._session = session;
        this._getTrayUris = getTrayUris;
        this._targets = [];
        this._receiving = receiving;

        this._left = new St.BoxLayout({vertical: true, style_class: 'osmin-lsv-col', x_expand: true, y_expand: true});
        this._right = new St.BoxLayout({vertical: true, style_class: 'osmin-lsv-col osmin-lsv-right', x_expand: true, y_expand: true});
        this.add_child(this._left);
        this.add_child(this._right);

        session.connectObject('changed', () => this._render(), this);
        this.connect('notify::mapped', () => {
            if (this.mapped)
                session.refresh();
        });
        this.connect('destroy', () => session.disconnectObject(this));
        this._render();
    }

    _render() {
        this._renderNow();
        this.onContentChanged?.();
    }

    get scrollTargets() {
        return this._targets;
    }

    _renderNow() {
        this._targets = [];
        this._left.destroy_all_children();
        this._right.destroy_all_children();
        this._buildFiles();
        this._buildRight();
    }

    _heading(text, action = null) {
        const row = new St.BoxLayout({style_class: 'osmin-lsv-heading'});
        row.add_child(new St.Label({text, style_class: 'osmin-lsv-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        if (action) {
            const button = new St.Button({label: action.label, style_class: 'osmin-tray-clear', can_focus: true});
            button.connect('clicked', () => action.onClick());
            row.add_child(button);
        }
        return row;
    }

    // --- files ----------------------------------------------------------------

    _buildFiles() {
        const files = this._session.basket;
        let total = 0;
        const rows = new St.BoxLayout({vertical: true, x_expand: true});
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
            const row = new St.BoxLayout({style_class: 'osmin-ls-file', x_expand: true});
            const image = new St.Icon({icon_name: 'text-x-generic-symbolic', style_class: 'osmin-ls-file-icon', y_align: Clutter.ActorAlign.CENTER});
            if (icon)
                image.gicon = icon;
            row.add_child(image);
            const name = new St.Label({text: file.get_basename(), style_class: 'osmin-ls-file-name', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            name.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
            row.add_child(name);
            row.add_child(new St.Label({text: sizeText(size), style_class: 'osmin-ls-device-model', y_align: Clutter.ActorAlign.CENTER}));
            const remove = createButton({
                iconName: 'window-close-symbolic',
                styleClass: 'osmin-ls-file-remove',
                onClick: () => this._session.remove([uri]),
            });
            remove.y_align = Clutter.ActorAlign.CENTER;
            row.add_child(remove);
            rows.add_child(row);
        }

        const title = files.length === 0 ? 'Files' : `Files · ${files.length} · ${sizeText(total)}`;
        this._left.add_child(this._heading(title, files.length > 0 ? {label: 'Clear', onClick: () => this._session.remove([...files])} : null));

        if (files.length === 0) {
            const empty = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'osmin-ls-note'});
            empty.add_child(new St.Label({text: 'Drop files on the capsule, or add them from the Tray', style_class: 'osmin-ls-status', x_align: Clutter.ActorAlign.CENTER}));
            const add = createButton({label: 'Add from Tray', styleClass: 'osmin-ls-cancel', onClick: () => this._session.offer(this._getTrayUris())});
            add.x_align = Clutter.ActorAlign.CENTER;
            empty.add_child(add);
            this._left.add_child(empty);
            return;
        }
        const scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        scroll.add_child(rows);
        this._left.add_child(scroll);
        this._targets.push({scroll, list: rows});
    }

    // --- devices / transfer -----------------------------------------------------

    _buildRight() {
        const s = this._session;
        switch (s.phase) {
        case 'waiting':
        case 'sending':
            this._right.add_child(this._heading(`To ${s.device?.alias ?? 'device'}`));
            this._right.add_child(this._createProgress());
            break;
        case 'done':
            this._right.add_child(this._heading('Done'));
            this._right.add_child(this._createNote('emblem-ok-symbolic', s.message, {label: 'OK', onClick: () => s.refresh()}));
            break;
        case 'error':
            this._right.add_child(this._heading('LocalSend'));
            this._right.add_child(this._createNote('dialog-warning-symbolic', s.message, {label: 'Try again', onClick: () => s.refresh({force: true})}));
            break;
        default:
            this._right.add_child(this._heading(s.phase === 'scan' ? 'Looking for devices…' : 'Send to',
                {label: 'Refresh', onClick: () => s.refresh({force: true})}));
            this._right.add_child(this._createDevices());
        }
        this._right.add_child(this._createReceiveRow());
    }

    _createDevices() {
        const s = this._session;
        if (s.devices.length === 0) {
            return this._createNote('network-wireless-symbolic', s.phase === 'scan'
                ? 'Open LocalSend on the other device (same network)' : 'No devices found',
            s.phase === 'pick' ? {label: 'Search again', onClick: () => s.refresh({force: true})} : null);
        }
        const list = new St.BoxLayout({vertical: true, style_class: 'osmin-ls-list', x_expand: true});
        const empty = s.basket.length === 0;
        for (const device of s.devices) {
            const row = new St.Button({style_class: 'osmin-ls-device', x_expand: true, can_focus: true, reactive: !empty, opacity: empty ? 110 : 255});
            const box = new St.BoxLayout({x_expand: true});
            box.add_child(new St.Icon({
                icon_name: DEVICE_ICONS[device.deviceType] ?? 'computer-symbolic',
                style_class: 'osmin-ls-device-icon',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            const name = new St.Label({text: device.alias, style_class: 'osmin-ls-device-name', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            box.add_child(name);
            box.add_child(new St.Label({text: device.deviceModel, style_class: 'osmin-ls-device-model', y_align: Clutter.ActorAlign.CENTER}));
            row.set_child(box);
            row.connect('clicked', () => s.sendTo(device));
            list.add_child(row);
        }
        const scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        scroll.add_child(list);
        this._targets.push({scroll, list});
        return scroll;
    }

    _createProgress() {
        const s = this._session;
        const box = new St.BoxLayout({vertical: true, style_class: 'osmin-ls-progress', x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER});
        box.add_child(new St.Label({
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
        box.add_child(stack);
        const cancel = createButton({label: 'Cancel', styleClass: 'osmin-ls-cancel', onClick: () => s.cancel()});
        cancel.x_align = Clutter.ActorAlign.START;
        box.add_child(cancel);
        return box;
    }

    _createNote(iconName, text, action = null) {
        const box = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'osmin-ls-note'});
        const line = new St.BoxLayout({x_align: Clutter.ActorAlign.START});
        line.add_child(new St.Icon({icon_name: iconName, style_class: 'osmin-ls-note-icon', y_align: Clutter.ActorAlign.CENTER}));
        const label = new St.Label({text, style_class: 'osmin-ls-status', y_align: Clutter.ActorAlign.CENTER});
        label.clutter_text.line_wrap = true;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        line.add_child(label);
        box.add_child(line);
        if (action) {
            const button = createButton({label: action.label, styleClass: 'osmin-ls-cancel', onClick: action.onClick});
            button.x_align = Clutter.ActorAlign.START;
            box.add_child(button);
        }
        return box;
    }

    /** "Receive files": whether other devices can send to this computer. */
    _createReceiveRow() {
        const row = new St.BoxLayout({style_class: 'osmin-lsv-receive'});
        row.add_child(new St.Label({text: 'Receive files', style_class: 'osmin-ls-device-model', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        const on = this._receiving.get();
        const button = new St.Button({label: on ? 'On' : 'Off', style_class: `osmin-tray-clear osmin-lsv-toggle${on ? ' osmin-lsv-on' : ''}`, can_focus: true});
        button.connect('clicked', () => {
            this._receiving.set(!this._receiving.get());
            this._render();
        });
        row.add_child(button);
        return row;
    }

    destroy() {
        this._session.disconnectObject(this);
        super.destroy();
    }
}
