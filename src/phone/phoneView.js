import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {QrCode} from '../ui/qrCode.js';
import {scaled} from '../utils/scale.js';
import {PhoneStream, StreamState} from './phoneStream.js';
import {ScreenEffect} from './screenEffect.js';

const LEASE_RENEW_S = 5;
const SCREEN_RADIUS = 26;     // css px
const KEYS = {
    [Clutter.KEY_BackSpace]: 67, [Clutter.KEY_Return]: 66, [Clutter.KEY_KP_Enter]: 66, [Clutter.KEY_Tab]: 61,
    [Clutter.KEY_Escape]: 4, [Clutter.KEY_Home]: 3, [Clutter.KEY_Left]: 21, [Clutter.KEY_Right]: 22,
    [Clutter.KEY_Up]: 19, [Clutter.KEY_Down]: 20, [Clutter.KEY_Delete]: 112,
};

const actionButton = (icon, tooltip, onClick) => {
    const button = new St.Button({style_class: 'osmin-phone-tool', reactive: true, can_focus: true, track_hover: true, accessible_name: tooltip});
    button.set_child(new St.Icon({icon_name: icon, style_class: 'osmin-phone-tool-icon'}));
    button.connect('clicked', () => onClick());
    return button;
};

const textButton = (label, onClick, primary = false) => {
    const button = new St.Button({style_class: `osmin-phone-pill${primary ? ' osmin-phone-pill-primary' : ''}`, reactive: true, can_focus: true, track_hover: true, x_align: Clutter.ActorAlign.CENTER});
    button.set_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
    button.connect('clicked', () => onClick());
    return button;
};

/**
 * The Phone section of the capsule: the screen of a connected Android phone, as big as the phone, with
 * round corners and a thin frame, and a slim row of buttons beside it. Without a phone it shows the
 * QR code that connects one. The phone can be taken out into a window of its own and brought back.
 */
export class PhoneView extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminPhoneView'}, this);
    }

    /** @param {{phone: ModuleClient, ui: {beginTextInput: Function, endTextInput: Function}}} params */
    constructor({phone, ui}) {
        super({vertical: true, style_class: 'osmin-phone-view', x_expand: true, y_expand: true});
        this._phone = phone;
        this._ui = ui;
        this._stream = new PhoneStream();
        this._active = false;
        this._renewId = 0;
        this._touching = false;
        this.onContentChanged = () => {};   // the capsule resizes itself when the content's height changes
        this._phone?.connectObject('state-changed', () => this._refresh(), this);
        this._phone?.connectObject('event', (_m, name) => name === 'connected' && this._refresh(), this);
        this._stream.connectObject('state-changed', () => this._draw(), this);
        this._stream.connectObject('content-changed', () => this._draw(), this);
        this.connect('destroy', () => {
            this._phone?.disconnectObject(this);
            this._stream.disconnectObject(this);
            this._stream.destroy();
            if (this._renewId)
                GLib.source_remove(this._renewId);
            this._renewId = 0;
            this._active = false;
            this._touching = false;
            this._grab = null;
        });
        this._draw();
    }

    /** The section is on screen (true) or not (false): the phone is only watched and streamed while it is. */
    setActive(active) {
        if (active === this._active)
            return;
        this._active = active;
        if (active) {
            this._lease();
            this._renewId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, LEASE_RENEW_S, () => {
                this._lease();
                return GLib.SOURCE_CONTINUE;
            });
        } else {
            if (this._renewId)
                GLib.source_remove(this._renewId);
            this._renewId = 0;
            this._phone?.call('watch', {on: false}).catch(() => {});
            this._endTouch();
            this._ui.endTextInput();
        }
        this._refresh();
    }

    _lease() {
        this._phone?.call('watch', {on: true}).catch(() => {});
    }

    get _device() {
        return (this._phone?.state?.devices ?? []).find(d => d.state === 'device') ?? null;
    }

    /** Starts or stops the picture to match the state, then draws. */
    _refresh() {
        const state = this._phone?.state ?? {};
        const device = this._device;
        if (this._active && device && !state.mirroring && state.adbPath) {
            if (this._stream.serial !== device.serial)
                this._stream.start(state.adbPath, device.serial);
        } else if (this._stream.state !== StreamState.OFF) {
            this._stream.stop();
        }
        this._draw();
    }

    _call(method, args = {}) {
        this._phone?.call(method, args).catch(e => console.warn(`[osmin] phone: ${e.message}`));
    }

    // --- drawing -------------------------------------------------------------------------------------

    _draw() {
        this._endTouch();
        this.destroy_all_children();
        const state = this._phone?.state ?? {};
        const device = this._device;
        if (!state.adb)
            this._drawMessage('Install adb first', 'adb is the standard Android tool that talks to the phone.', 'sudo apt install adb');
        else if (state.mirroring)
            this._drawPoppedOut();
        else if (device)
            this._drawPhone(device);
        else if (state.pairing)
            this._drawPairing(state.pairing);
        else
            this._drawStart();
        this.onContentChanged();
    }

    _center() {
        const box = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, style_class: 'osmin-phone-center'});
        this.add_child(box);
        return box;
    }

    _text(text, style) {
        const label = new St.Label({text, style_class: style, x_align: Clutter.ActorAlign.CENTER});
        label.clutter_text.line_wrap = true;
        label.clutter_text.set_justify(true);
        return label;
    }

    _drawMessage(title, text, command = '') {
        const box = this._center();
        box.add_child(new St.Icon({icon_name: 'phone-symbolic', style_class: 'osmin-phone-bigicon', x_align: Clutter.ActorAlign.CENTER}));
        box.add_child(this._text(title, 'osmin-phone-title'));
        box.add_child(this._text(text, 'osmin-phone-note'));
        if (command)
            box.add_child(new St.Label({text: command, style_class: 'osmin-phone-code', x_align: Clutter.ActorAlign.CENTER}));
    }

    _drawStart() {
        const box = this._center();
        box.add_child(new St.Icon({icon_name: 'phone-symbolic', style_class: 'osmin-phone-bigicon', x_align: Clutter.ActorAlign.CENTER}));
        box.add_child(this._text('Your phone on this screen', 'osmin-phone-title'));
        box.add_child(this._text('See it, tap, swipe and type with the mouse and the keyboard. Android 11 or newer, on the same Wi-Fi.', 'osmin-phone-note'));
        box.add_child(textButton('Show the QR code', () => this._call('startPairing'), true));
    }

    _drawPairing(pairing) {
        const box = this._center();
        const qr = new QrCode(scaled(188));
        qr.setText(pairing.text);
        box.add_child(qr);
        box.add_child(this._text(pairing.message || (pairing.status === 'waiting' ? 'Waiting for the phone…' : ''), 'osmin-phone-title'));
        box.add_child(this._text('Settings › Developer options › Wireless debugging › Pair device with QR code, and scan this code with that scanner (not the camera app).', 'osmin-phone-note'));
        const row = new St.BoxLayout({style_class: 'osmin-phone-row', x_align: Clutter.ActorAlign.CENTER});
        if (pairing.status === 'failed')
            row.add_child(textButton('Try again', () => this._call('startPairing'), true));
        row.add_child(textButton('Cancel', () => this._call('cancelPairing')));
        box.add_child(row);
    }

    _drawPoppedOut() {
        const box = this._center();
        box.add_child(new St.Icon({icon_name: 'preferences-system-windows-symbolic', style_class: 'osmin-phone-bigicon', x_align: Clutter.ActorAlign.CENTER}));
        box.add_child(this._text('The phone is in its own window', 'osmin-phone-title'));
        box.add_child(textButton('Bring it back here', () => this._call('stopMirror'), true));
    }

    _drawPhone(device) {
        const stream = this._stream;
        const row = new St.BoxLayout({x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, style_class: 'osmin-phone-stage'});
        this.add_child(row);

        const monitor = Main.layoutManager.primaryMonitor;
        const height = Math.round(Math.min(monitor.height * 0.62, 760));
        const aspect = stream.screen ? stream.screen.w / stream.screen.h : 9 / 20;
        const width = Math.round(height * aspect);

        const frame = new St.Widget({style_class: 'osmin-phone-frame', layout_manager: new Clutter.BinLayout(), width: width + 6, height: height + 6});
        row.add_child(frame);
        const screen = new St.Widget({
            style_class: 'osmin-phone-screen',
            reactive: true,
            can_focus: true,
            x_expand: true,
            y_expand: true,
            width,
            height,
            content_gravity: Clutter.ContentGravity.RESIZE_FILL,
        });
        if (stream.content)
            screen.content = stream.content;
        // The round corners clip a holder around the picture (an effect on the widget that carries the picture does not compile).
        const holder = new St.Widget({layout_manager: new Clutter.BinLayout(), width, height, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        holder.add_effect(new ScreenEffect(width, height, scaled(SCREEN_RADIUS)));
        holder.add_child(screen);
        frame.add_child(holder);
        this._screen = screen;
        this._wirePointer(screen);

        if (stream.state !== StreamState.ON) {
            const status = this._text(stream.state === StreamState.ERROR ? stream.error : `Opening ${device.model || 'the phone'}…`, 'osmin-phone-status');
            status.x_expand = true;
            status.y_expand = true;
            status.y_align = Clutter.ActorAlign.CENTER;
            frame.add_child(status);
        }

        const tools = new St.BoxLayout({vertical: true, style_class: 'osmin-phone-tools', y_align: Clutter.ActorAlign.CENTER});
        row.add_child(tools);
        const control = () => this._stream.control;
        tools.add_child(actionButton('go-previous-symbolic', 'Back', () => control()?.key(4)));
        tools.add_child(actionButton('go-home-symbolic', 'Home', () => control()?.key(3)));
        tools.add_child(actionButton('view-grid-symbolic', 'Recent apps', () => control()?.key(187)));
        tools.add_child(actionButton('preferences-system-notifications-symbolic', 'Notifications', () => control()?.shell('cmd statusbar expand-notifications')));
        tools.add_child(actionButton('system-shutdown-symbolic', 'Lock or wake the screen', () => control()?.key(26)));
        tools.add_child(new St.Widget({style_class: 'osmin-phone-tools-gap'}));
        tools.add_child(actionButton('window-new-symbolic', 'Open in a window', () => this._popOut(device)));
        tools.add_child(actionButton('network-offline-symbolic', 'Disconnect', () => this._call('disconnect', {serial: device.serial})));
    }

    _popOut(device) {
        this._stream.stop();
        this._call('mirror', {serial: device.serial});
    }

    // --- mouse and keyboard ----------------------------------------------------------------------------

    /** A point of the stage -> a pixel of the phone's screen (clamped to it). */
    _toPhone(screen, stageX, stageY) {
        const phone = this._stream.screen;
        if (!phone)
            return null;
        const [ok, x, y] = screen.transform_stage_point(stageX, stageY);
        if (!ok)
            return null;
        const px = Math.min(Math.max(x / screen.width, 0), 1) * phone.w;
        const py = Math.min(Math.max(y / screen.height, 0), 1) * phone.h;
        return [Math.round(Math.min(px, phone.w - 1)), Math.round(Math.min(py, phone.h - 1))];
    }

    _wirePointer(screen) {
        screen.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            const point = this._toPhone(screen, ...event.get_coords());
            if (!point)
                return Clutter.EVENT_PROPAGATE;
            // The keyboard goes to the phone from now on, until the pointer leaves the capsule.
            this._ui.beginTextInput(() => {});
            screen.grab_key_focus();
            this._touching = true;
            this._last = point;
            this._grab = global.stage.grab(screen);
            this._stream.control?.down(point[0], point[1]);
            return Clutter.EVENT_STOP;
        });
        screen.connect('motion-event', (_a, event) => {
            if (!this._touching)
                return Clutter.EVENT_PROPAGATE;
            const point = this._toPhone(screen, ...event.get_coords());
            if (point) {
                this._last = point;
                this._stream.control?.move(point[0], point[1]);
            }
            return Clutter.EVENT_STOP;
        });
        screen.connect('button-release-event', (_a, event) => {
            if (!this._touching)
                return Clutter.EVENT_PROPAGATE;
            const point = this._toPhone(screen, ...event.get_coords());
            if (point)
                this._stream.control?.up(point[0], point[1]);
            this._endTouch(false);
            return Clutter.EVENT_STOP;
        });
        let lastScroll = 0;
        screen.connect('scroll-event', (_a, event) => {
            const phone = this._stream.screen;
            const now = GLib.get_monotonic_time();
            if (!phone || now - lastScroll < 200000)
                return Clutter.EVENT_STOP;
            const direction = event.get_scroll_direction();
            if (direction !== Clutter.ScrollDirection.UP && direction !== Clutter.ScrollDirection.DOWN)
                return Clutter.EVENT_STOP;
            lastScroll = now;
            const x = Math.round(phone.w / 2);
            const y = Math.round(phone.h / 2);
            const d = Math.round(phone.h * 0.25) * (direction === Clutter.ScrollDirection.DOWN ? -1 : 1);
            this._stream.control?.swipe(x, y, x, y + d, 220);
            return Clutter.EVENT_STOP;
        });
        screen.connect('key-press-event', (_a, event) => {
            const control = this._stream.control;
            if (!control)
                return Clutter.EVENT_PROPAGATE;
            const code = KEYS[event.get_key_symbol()];
            if (code !== undefined) {
                control.key(code);
                return Clutter.EVENT_STOP;
            }
            const char = event.get_key_unicode();
            const unicode = typeof char === 'number' ? char : (char?.codePointAt(0) ?? 0);
            if (unicode >= 32 && unicode < 127) {
                control.text(String.fromCodePoint(unicode));
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    /** The finger is lifted (and the pointer grab let go). `lift` sends a last "up" when the view is rebuilt in the middle of a touch. */
    _endTouch(lift = true) {
        if (this._touching && lift && this._last)
            this._stream.control?.up(this._last[0], this._last[1]);
        this._touching = false;
        this._grab?.dismiss();
        this._grab = null;
    }
}
