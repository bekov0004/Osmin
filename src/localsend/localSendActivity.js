import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {createButton} from '../ui/button.js';
import {LiveActivity} from '../ui/liveActivity.js';
import {scaled} from '../utils/scale.js';

const HEIGHT = 276; // css px
const BAR_WIDTH = 250;

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
 * "Send to…": the card that opens when files are dropped on the LocalSend target. It lists the
 * devices found on the network, and after a pick shows the transfer (waiting for the receiver to
 * accept, progress, done / error). Closing the card does not stop a transfer: its end is
 * announced with a notification instead.
 */
export class LocalSendActivity extends LiveActivity {
    /** @param {{service: LocalSendService, onDismiss: () => void, notify: (title, description, icon) => void}} params */
    constructor({service, onDismiss, notify}) {
        super({id: 'localsend', widgetId: 'tray'});
        this._service = service;
        this._onDismiss = onDismiss;
        this._notify = notify;
        this._cancellable = null;
        this._device = null;
        this.phase = 'scan';   // scan | pick | waiting | sending | done | error
        this.devices = [];
        this.sent = 0;
        this.total = 0;
        this.message = '';
        this.shown = false;
        this._gone = false;
        this._scanned = false;
        this._dismissTimer = 0;
    }

    get title() {
        return 'LocalSend';
    }

    get peekSize() {
        return {width: 330, height: HEIGHT};
    }

    createCompactParts() {
        throw new Error('The LocalSend card has no compact face');
    }

    /** Files were dropped / sent from the tray: they join the basket; after a transfer, start over. */
    offer(uris) {
        this._service.addToBasket(uris);
        if (this.phase === 'done' || this.phase === 'error' || !this._scanned)
            this.scan();
        else
            this.notifyChanged();
    }

    /** Starts looking for devices. */
    scan() {
        this.devices = [];
        this.phase = 'scan';
        this._scanned = true;
        this.notifyChanged();
        this._service.disconnectObject(this);
        this._service.connectObject('found', (_s, device) => {
            if (this.phase !== 'scan' || this.devices.some(d => d.ip === device.ip))
                return;
            this.devices.push(device);
            this.notifyChanged();
        }, this);
        this._service.scan().then(() => {
            if (this._gone || this.phase !== 'scan')
                return;
            this.phase = 'pick';
            this.notifyChanged();
        });
    }

    /** Sends the files to a device. */
    async sendTo(device) {
        const uris = [...this._service.basket];
        if (this._cancellable || uris.length === 0)
            return;
        this._service.cancelScan();
        this._device = device;
        this._cancellable = new Gio.Cancellable();
        this.phase = 'waiting';
        this.total = 0;
        this.sent = 0;
        this.notifyChanged();
        try {
            const result = await this._service.send(device, uris, {
                cancellable: this._cancellable,
                onState: state => {
                    this.phase = state.phase;
                    this.sent = state.sent;
                    this.total = state.total;
                    this.notifyChanged();
                },
            });
            this._service.removeFromBasket(uris);
            this.phase = 'done';
            this.message = result.skipped > 0 ? `Sent (${result.skipped} folder skipped)` : `Sent to ${device.alias}`;
            if (!this.shown)
                this._notify(`Sent to ${device.alias}`, `${result.count} file${result.count === 1 ? '' : 's'}`, 'emblem-ok-symbolic');
            else
                this._dismissLater(2500);
        } catch (e) {
            this.phase = 'error';
            this.message = e.message;
            if (!this.shown && e.message !== 'Cancelled')
                this._notify('LocalSend', e.message, 'dialog-warning-symbolic');
        }
        this._cancellable = null;
        if (!this._gone)
            this.notifyChanged();
    }

    _dismissLater(ms) {
        this._dismissTimer = setTimeout(() => this._onDismiss(), ms);
    }

    /** Stops a transfer that is on its way. */
    cancel() {
        this._cancellable?.cancel();
    }

    createPeekView() {
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-ls',
            x_expand: true,
            y_expand: true,
        });

        const header = new St.BoxLayout({style_class: 'osmin-ls-header'});
        const title = new St.Label({style_class: 'osmin-ls-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        header.add_child(title);
        const close = createButton({
            iconName: 'window-close-symbolic',
            styleClass: 'osmin-mirror-control',
            onClick: () => this._onDismiss(),
        });
        close.y_align = Clutter.ActorAlign.CENTER;
        header.add_child(close);
        root.add_child(header);

        const body = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true});
        root.add_child(body);

        const render = () => {
            body.destroy_all_children();
            const count = this._service.basket.length;
            switch (this.phase) {
            case 'scan':
            case 'pick':
                title.text = this.phase === 'scan' ? 'Looking for devices…' : 'Send to';
                body.add_child(this._createBasket());
                body.add_child(count > 0 ? this._createList() : this._createNote('document-send-symbolic',
                    'Drop files on the LocalSend target, or use the send button on a file in the tray'));
                break;
            case 'waiting':
            case 'sending':
                title.text = this._device ? `To ${this._device.alias}` : 'Sending';
                body.add_child(this._createProgress());
                break;
            case 'done':
                title.text = 'Done';
                body.add_child(this._createNote('emblem-ok-symbolic', this.message));
                break;
            default:
                title.text = 'LocalSend';
                body.add_child(this._createNote('dialog-warning-symbolic', this.message,
                    {label: 'Try again', onClick: () => this.scan()}));
            }
            close.visible = true;
        };

        this.connectObject('changed', render, root);
        this._service.connectObject('basket-changed', render, root);
        this.shown = true;
        root.connect('destroy', () => {
            this.disconnectObject(root);
            this._service.disconnectObject(root);
            this.shown = false;
        });
        render();
        return root;
    }

    /** The files waiting to be sent, each with a remove button. */
    _createBasket() {
        const files = this._service.basket;
        const box = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'osmin-ls-basket'});
        if (files.length === 0)
            return box;
        const rows = new St.BoxLayout({vertical: true, x_expand: true});
        let total = 0;
        for (const uri of files) {
            const file = Gio.File.new_for_uri(uri);
            let size = 0;
            let icon = null;
            try {
                const info = file.query_info('standard::size,standard::symbolic-icon', Gio.FileQueryInfoFlags.NONE, null);
                size = info.get_size();
                icon = info.get_symbolic_icon();
            } catch (e) {
                // gone since it was added: it is skipped when sending
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
                onClick: () => this._service.removeFromBasket([uri]),
            });
            remove.y_align = Clutter.ActorAlign.CENTER;
            row.add_child(remove);
            rows.add_child(row);
        }
        const scroll = new St.ScrollView({
            style_class: 'osmin-ls-basket-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
        });
        scroll.add_child(rows);
        box.add_child(scroll);
        const summary = new St.BoxLayout({style_class: 'osmin-ls-summary'});
        summary.add_child(new St.Label({
            text: `${files.length} file${files.length === 1 ? '' : 's'} · ${sizeText(total)}  —  drop more to add`,
            style_class: 'osmin-ls-device-model',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const clear = new St.Button({label: 'Clear', style_class: 'osmin-tray-clear', can_focus: true});
        clear.connect('clicked', () => this._service.removeFromBasket([...files]));
        summary.add_child(clear);
        box.add_child(summary);
        return box;
    }

    _createList() {
        const list = new St.BoxLayout({vertical: true, style_class: 'osmin-ls-list', x_expand: true});
        for (const device of this.devices) {
            const row = new St.Button({style_class: 'osmin-ls-device', x_expand: true, can_focus: true});
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
            row.connect('clicked', () => this.sendTo(device));
            list.add_child(row);
        }
        if (this.devices.length === 0 && this.phase === 'pick') {
            return this._createNote('network-wireless-symbolic', 'No devices found. Open LocalSend on the other device, on the same network.',
                {label: 'Search again', onClick: () => this.scan()});
        }
        if (this.devices.length === 0)
            return this._createNote('network-wireless-symbolic', 'Open LocalSend on the other device (same network)');
        const scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        scroll.add_child(list);
        return scroll;
    }

    _createProgress() {
        const box = new St.BoxLayout({vertical: true, style_class: 'osmin-ls-progress', x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const waiting = this.phase === 'waiting';
        box.add_child(new St.Label({
            text: waiting ? `Waiting for ${this._device?.alias ?? 'the device'} to accept…`
                : `${sizeText(this.sent)} of ${sizeText(this.total)}`,
            style_class: 'osmin-ls-status',
        }));
        const track = new St.Widget({style_class: 'osmin-ls-bar', width: scaled(BAR_WIDTH), x_align: Clutter.ActorAlign.START});
        const fill = new St.Widget({
            style_class: 'osmin-ls-bar-fill',
            width: scaled(BAR_WIDTH) * (this.total > 0 ? this.sent / this.total : 0),
            x_align: Clutter.ActorAlign.START,
        });
        const stack = new St.Widget({layout_manager: new Clutter.BinLayout()});
        stack.add_child(track);
        stack.add_child(fill);
        box.add_child(stack);
        const cancel = createButton({label: 'Cancel', styleClass: 'osmin-ls-cancel', onClick: () => this.cancel()});
        cancel.x_align = Clutter.ActorAlign.CENTER;
        box.add_child(cancel);
        return box;
    }

    _createNote(iconName, text, action = null) {
        const box = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'osmin-ls-note'});
        const line = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER});
        line.add_child(new St.Icon({icon_name: iconName, style_class: 'osmin-ls-note-icon', y_align: Clutter.ActorAlign.CENTER}));
        const label = new St.Label({text, style_class: 'osmin-ls-status', y_align: Clutter.ActorAlign.CENTER});
        label.clutter_text.line_wrap = true;
        line.add_child(label);
        box.add_child(line);
        if (action) {
            const button = createButton({label: action.label, styleClass: 'osmin-ls-cancel', onClick: action.onClick});
            button.x_align = Clutter.ActorAlign.CENTER;
            box.add_child(button);
        }
        return box;
    }

    destroy() {
        this._gone = true;
        this._cancellable?.cancel();
        this._service.cancelScan();
        this._service.disconnectObject(this);
        if (this._dismissTimer)
            clearTimeout(this._dismissTimer);
    }
}
