import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {iconRow, menuCard, menuDivider, pillButton} from '../../ui/menuKit.js';
import {QrCode} from '../../ui/qrCode.js';
import {OsminWidget} from '../widget.js';

const LEASE_RENEW_S = 5;
const INSTALL_COMMAND = 'sudo apt install adb';

/**
 * Phone: see the screen of an Android phone on the computer and control it. A QR code on this page is
 * scanned in the phone's Developer options (Wireless debugging > Pair device with QR code); Osmin pairs
 * with it and opens the screen in a window of its own. The work is done by the Osmin service (service/phone).
 */
export class PhoneWidget extends OsminWidget {
    static id = 'phone';
    static title = 'Phone';
    static iconName = 'phone-symbolic';
    static menuNative = true;

    constructor(context) {
        super(context);
        this._phone = context.services.backend?.phone;
        this._shown = false;
        this._renewId = 0;
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-phone osmin-menu-page', x_expand: true});
        this._card = menuCard();
        this._card.add_style_class_name('osmin-bigcard');
        root.add_child(this._card);
        this._body = new St.BoxLayout({vertical: true, x_expand: true});
        this._card.add_child(this._body);
        this._phone?.connectObject('state-changed', () => this._draw(), this);
        this._draw();
        return root;
    }

    onPageShown() {
        this._shown = true;
        this._lease();
        if (!this._renewId) {
            this._renewId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, LEASE_RENEW_S, () => {
                this._lease();
                return GLib.SOURCE_CONTINUE;
            });
        }
        this._draw();
    }

    onPageHidden() {
        this._shown = false;
        if (this._renewId)
            GLib.source_remove(this._renewId);
        this._renewId = 0;
        this._phone?.call('watch', {on: false}).catch(() => {});
    }

    _lease() {
        this._phone?.call('watch', {on: true}).catch(() => {});
    }

    _call(method, args = {}) {
        this._phone?.call(method, args).catch(e => this._say(e.message));
    }

    _say(text) {
        this.context.events.emit({type: 'custom', icon: 'phone-symbolic', title: 'Phone', description: text, duration: 3500});
    }

    _label(text, style) {
        const label = new St.Label({text, style_class: style, x_expand: true});
        label.clutter_text.line_wrap = true;
        return label;
    }

    /** Rebuilds the page from the service's state: it is small and changes rarely. */
    _draw() {
        if (!this._body)
            return;
        this._body.destroy_all_children();
        const state = this._phone?.state ?? {};
        const body = this._body;

        if (!state.adb) {
            const {row} = iconRow({icon: 'dialog-information-symbolic', title: 'Install adb first',
                subtitle: 'adb is the standard Android tool that talks to the phone. One command installs it:'});
            body.add_child(row);
            const command = new St.Label({text: INSTALL_COMMAND, style_class: 'osmin-code', x_expand: true});
            body.add_child(command);
            const copy = pillButton({label: 'Copy the command', icon: 'edit-copy-symbolic', onClick: () => {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, INSTALL_COMMAND);
                this._say('Copied. Paste it in a terminal.');
            }});
            const wrap = new St.BoxLayout({style_class: 'osmin-pill-row', x_expand: true});
            wrap.add_child(copy);
            body.add_child(wrap);
            body.add_child(menuDivider());
        }

        const devices = state.devices ?? [];
        for (const device of devices) {
            const showing = state.mirroring === device.serial;
            const title = device.model || device.serial;
            const subtitle = device.state !== 'device' ? device.state : showing ? 'Showing on this screen' : 'Connected';
            const controls = new St.BoxLayout({style_class: 'osmin-phone-actions'});
            if (device.state === 'device') {
                controls.add_child(pillButton({label: showing ? 'Stop' : 'Show screen', icon: showing ? 'media-playback-stop-symbolic' : 'video-display-symbolic',
                    onClick: () => this._call(showing ? 'stopMirror' : 'mirror', {serial: device.serial})}));
            }
            controls.add_child(pillButton({label: 'Disconnect', onClick: () => this._call('disconnect', {serial: device.serial})}));
            const {row} = iconRow({icon: 'phone-symbolic', title, subtitle, extra: controls});
            body.add_child(row);
            body.add_child(menuDivider());
        }

        const pairing = state.pairing;
        if (pairing) {
            const qr = new QrCode(196);
            qr.setText(pairing.text);
            const qrBox = new St.BoxLayout({x_expand: true, style_class: 'osmin-qr-box', x_align: Clutter.ActorAlign.CENTER});
            qrBox.add_child(qr);
            body.add_child(qrBox);
            body.add_child(this._label(pairing.message || (pairing.status === 'waiting' ? 'Waiting for the phone…' : ''), 'osmin-phone-status'));
            const steps = ['On the phone: Settings › Developer options › Wireless debugging.',
                'Turn it on, tap “Pair device with QR code” and scan this code.',
                'The phone and the computer must be on the same Wi-Fi.'];
            for (const [i, text] of steps.entries())
                body.add_child(this._label(`${i + 1}. ${text}`, 'osmin-phone-step'));
            const wrap = new St.BoxLayout({style_class: 'osmin-pill-row', x_expand: true});
            wrap.add_child(pillButton({label: pairing.status === 'failed' ? 'Try again' : 'Cancel', onClick: () => {
                if (pairing.status === 'failed')
                    this._call('startPairing');
                else
                    this._call('cancelPairing');
            }}));
            if (pairing.status === 'failed')
                wrap.add_child(pillButton({label: 'Cancel', onClick: () => this._call('cancelPairing')}));
            body.add_child(wrap);
        } else {
            const ready = state.adb;
            const {row} = iconRow({icon: 'phone-symbolic', title: devices.length ? 'Connect another phone' : 'Connect a phone',
                subtitle: 'Show its screen here and control it with the mouse and keyboard. Android 11 or newer.'});
            body.add_child(row);
            const wrap = new St.BoxLayout({style_class: 'osmin-pill-row', x_expand: true});
            const button = pillButton({label: 'Show the QR code', icon: 'view-grid-symbolic', onClick: () => ready && this._call('startPairing')});
            button.reactive = !!ready;
            button.opacity = ready ? 255 : 90;
            wrap.add_child(button);
            body.add_child(wrap);
            body.add_child(this._label('Over a USB cable it works too: turn on USB debugging, plug the phone in and it appears in this list.', 'osmin-phone-step'));
        }
    }

    destroy() {
        this.onPageHidden();
        this._phone?.disconnectObject(this);
        super.destroy();
    }
}
