import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {createButton} from '../ui/button.js';
import {LiveActivity} from '../ui/liveActivity.js';
import {QrCode} from '../ui/qrCode.js';
import {scaled} from '../utils/scale.js';
import {PhoneStream, StreamState} from './phoneStream.js';
import {ScreenEffect} from './screenEffect.js';

const WIDTH = 330;            // css px, like the enlarged calendar
const INSET = 20;             // card width minus the picture's: 10 px on each side, a thin frame
const TOP = 36;               // the band of the top bar above the card's content
const BOTTOM = 14;
const RADIUS = 24;
const LEASE_RENEW_S = 5;
const KEYS = {
    [Clutter.KEY_BackSpace]: 67, [Clutter.KEY_Return]: 66, [Clutter.KEY_KP_Enter]: 66, [Clutter.KEY_Tab]: 61,
    [Clutter.KEY_Escape]: 4, [Clutter.KEY_Home]: 3, [Clutter.KEY_Left]: 21, [Clutter.KEY_Right]: 22,
    [Clutter.KEY_Up]: 19, [Clutter.KEY_Down]: 20, [Clutter.KEY_Delete]: 112,
};

const pill = (label, onClick, primary = false) => {
    const button = new St.Button({style_class: `osmin-phone-pill${primary ? ' osmin-phone-pill-primary' : ''}`, reactive: true, can_focus: true, track_hover: true, x_align: Clutter.ActorAlign.CENTER});
    button.set_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
    button.connect('clicked', () => onClick());
    return button;
};

/**
 * The enlarged phone: a card as wide as the enlarged calendar and as tall as the phone's screen,
 * which fills it, with round corners and a thin frame. Buttons show only while the pointer is over
 * it. Without a phone the card shows the QR code that connects one. Shown (persistent) from the
 * Phone widget; it is never "ongoing".
 */
export class PhoneCardActivity extends LiveActivity {
    /** @param {{phone: ModuleClient, ui: {beginTextInput: Function, endTextInput: Function}, onDismiss: Function, onResize: Function}} params */
    constructor({phone, ui, onDismiss, onResize}) {
        super({id: 'phone-card', widgetId: 'phonecard'});
        this._phone = phone;
        this._ui = ui;
        this._onDismiss = onDismiss;
        this._onResize = onResize;
        this.peekInset = 32;
    }

    get title() {
        return 'Phone';
    }

    get device() {
        return (this._phone?.state?.devices ?? []).find(d => d.state === 'device') ?? null;
    }

    /** What the card shows: a phone (connected, not in its own window) or a message with buttons. */
    get showsPhone() {
        const state = this._phone?.state ?? {};
        return !!(state.adb && this.device?.screen && !state.mirroring);
    }

    /** Size of the picture in css px (the phone's screen scaled to the card's width, or to the screen's height). */
    get screenSize() {
        const screen = this.device?.screen;
        if (!screen)
            return null;
        const monitorCss = Main.layoutManager.primaryMonitor.height / scaled(1);
        let width = WIDTH - INSET;
        let height = width * screen.h / screen.w;
        const max = monitorCss * 0.9 - TOP - BOTTOM;
        if (height > max) {
            height = max;
            width = Math.max(height * screen.w / screen.h, 200);
        }
        return {width: Math.round(width), height: Math.round(height)};
    }

    get peekSize() {
        if (this.showsPhone) {
            const {width, height} = this.screenSize;
            this.peekInset = INSET;
            return {width: width + INSET, height: height + TOP + BOTTOM};
        }
        this.peekInset = 32;
        return {width: WIDTH, height: 430};
    }

    createCompactParts() {
        throw new Error('The enlarged phone has no compact face');
    }

    createPeekView() {
        const phone = this._phone;
        const phoneMode = this.showsPhone;
        // The card gives its view all the room unless the view asks for less: a phone is exactly as big as the phone.
        const root = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: !phoneMode,
            y_expand: !phoneMode,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
            reactive: true,
            track_hover: true,
        });
        root.margin_top = scaled(TOP - 8);   // the card's own top is about 8 px below the screen's edge
        const stream = phoneMode ? new PhoneStream() : null;
        this._lastStream = stream;   // for the tests
        let renew = 0;
        let touching = false;
        let grab = null;
        let last = null;
        let gone = false;
        const shape = {phoneMode, serial: this.device?.serial ?? null};

        const lease = () => phone?.call('watch', {on: true}).catch(() => {});
        lease();
        renew = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, LEASE_RENEW_S, () => {
            lease();
            return GLib.SOURCE_CONTINUE;
        });

        if (phoneMode) {
            const {width, height} = this.screenSize;
            root.set_size(scaled(width), scaled(height));
            this._buildPhone(root, stream, {width: scaled(width), height: scaled(height)}, {
                touch: v => {
                    touching = v.touching ?? touching;
                    grab = v.grab !== undefined ? v.grab : grab;
                    last = v.last ?? last;
                    return {touching, grab, last};
                },
            });
            stream.start(phone.state.adbPath, this.device.serial);
        } else {
            this._buildMessage(root);
        }

        // The card has to change size when the phone comes or goes.
        const check = () => {
            if (gone)
                return;
            const now = {phoneMode: this.showsPhone, serial: this.device?.serial ?? null};
            if (now.phoneMode !== shape.phoneMode || now.serial !== shape.serial)
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (!gone)
                        this._onResize();
                    return GLib.SOURCE_REMOVE;
                });
            else if (!phoneMode)
                this._buildMessage(root);
        };
        phone?.connectObject('state-changed', check, root);

        root.connect('destroy', () => {
            gone = true;
            if (renew)
                GLib.source_remove(renew);
            phone?.disconnectObject(root);
            phone?.call('watch', {on: false}).catch(() => {});
            if (touching)
                stream?.control?.up(last?.[0] ?? 0, last?.[1] ?? 0);
            grab?.dismiss();
            stream?.destroy();
            try {
                this._ui.endTextInput();
            } catch (e) {
                // the capsule is going away with its own grab
            }
        });
        return root;
    }

    // --- the phone ---------------------------------------------------------------------------------

    _buildPhone(root, stream, {width, height}, state) {
        const holder = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
        holder.add_effect(new ScreenEffect(width, height, scaled(RADIUS)));
        const screen = new St.Widget({reactive: true, can_focus: true, x_expand: true, y_expand: true, content_gravity: Clutter.ContentGravity.RESIZE_FILL});
        holder.add_child(screen);
        root.add_child(holder);

        // A thin frame on top of the picture (it does not take clicks).
        root.add_child(new St.Widget({style_class: 'osmin-phone-frame', x_expand: true, y_expand: true, reactive: false}));

        const status = new St.Label({style_class: 'osmin-phone-status', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, text: 'Opening the phone…'});
        status.clutter_text.line_wrap = true;
        root.add_child(status);

        const update = () => {
            if (stream.content && screen.content !== stream.content)
                screen.content = stream.content;
            status.visible = stream.state !== StreamState.ON;
            if (stream.state === StreamState.ERROR)
                status.text = stream.error;
        };
        stream.connectObject('state-changed', update, root);
        stream.connectObject('content-changed', update, root);
        update();

        this._buildControls(root, stream);
        this._wirePointer(screen, stream, state);
    }

    /** Buttons that appear while the pointer is over the card: the phone's own keys, a window, close. */
    _buildControls(root, stream) {
        const control = () => stream.control;
        const small = (icon, onClick) => createButton({iconName: icon, styleClass: 'osmin-phone-control', onClick});

        const top = new St.BoxLayout({style_class: 'osmin-phone-controls', x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START, x_expand: true, y_expand: true});
        top.add_child(small('window-new-symbolic', () => {
            stream.stop();
            this._phone.call('mirror', {serial: this.device?.serial}).catch(() => {});
        }));
        top.add_child(small('go-up-symbolic', () => this._onDismiss()));

        const bottom = new St.BoxLayout({style_class: 'osmin-phone-controls', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.END, x_expand: true, y_expand: true});
        bottom.add_child(small('go-previous-symbolic', () => control()?.key(4)));
        bottom.add_child(small('go-home-symbolic', () => control()?.key(3)));
        bottom.add_child(small('view-grid-symbolic', () => control()?.key(187)));
        bottom.add_child(small('preferences-system-notifications-symbolic', () => control()?.shell('cmd statusbar expand-notifications')));

        // Unlock: a PIN or password is typed here once and goes to the phone; it is not kept.
        const pinBox = new St.BoxLayout({style_class: 'osmin-phone-pin', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.END, x_expand: true, y_expand: true, visible: false});
        const entry = new St.PasswordEntry({style_class: 'osmin-phone-pin-entry', hint_text: 'PIN or password', can_focus: true, x_expand: true});
        pinBox.add_child(entry);
        const closePin = () => {
            entry.set_text('');
            pinBox.hide();
            this._ui.endTextInput();
        };
        entry.clutter_text.connect('activate', () => {
            const secret = entry.get_text();
            closePin();
            control()?.unlock(secret, stream.screen);
        });
        entry.clutter_text.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            closePin();
            return Clutter.EVENT_STOP;
        });
        bottom.add_child(small('system-lock-screen-symbolic', () => {
            if (pinBox.visible) {
                closePin();
                return;
            }
            pinBox.show();
            this._ui.beginTextInput(() => {});
            entry.grab_key_focus();
        }));

        for (const actor of [top, bottom]) {
            actor.opacity = 0;
            root.add_child(actor);
        }
        root.add_child(pinBox);
        root.connect('notify::hover', () => {
            for (const actor of [top, bottom])
                actor.ease({opacity: root.hover ? 255 : 0, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        });
    }

    /** A point of the stage -> a pixel of the phone's screen (clamped to it). */
    _toPhone(screen, stream, stageX, stageY) {
        const phone = stream.screen;
        const [ok, x, y] = screen.transform_stage_point(stageX, stageY);
        if (!phone || !ok)
            return null;
        const px = Math.min(Math.max(x / screen.width, 0), 1) * phone.w;
        const py = Math.min(Math.max(y / screen.height, 0), 1) * phone.h;
        return [Math.round(Math.min(px, phone.w - 1)), Math.round(Math.min(py, phone.h - 1))];
    }

    _wirePointer(screen, stream, state) {
        screen.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            const point = this._toPhone(screen, stream, ...event.get_coords());
            if (!point)
                return Clutter.EVENT_PROPAGATE;
            // The keyboard goes to the phone from now on, until the pointer leaves the capsule.
            this._ui.beginTextInput(() => {});
            screen.grab_key_focus();
            state.touch({touching: true, last: point, grab: global.stage.grab(screen)});
            stream.control?.down(point[0], point[1]);
            return Clutter.EVENT_STOP;
        });
        screen.connect('motion-event', (_a, event) => {
            if (!state.touch({}).touching)
                return Clutter.EVENT_PROPAGATE;
            const point = this._toPhone(screen, stream, ...event.get_coords());
            if (point) {
                state.touch({last: point});
                stream.control?.move(point[0], point[1]);
            }
            return Clutter.EVENT_STOP;
        });
        screen.connect('button-release-event', (_a, event) => {
            const current = state.touch({});
            if (!current.touching)
                return Clutter.EVENT_PROPAGATE;
            const point = this._toPhone(screen, stream, ...event.get_coords());
            if (point)
                stream.control?.up(point[0], point[1]);
            current.grab?.dismiss();
            state.touch({touching: false, grab: null});
            return Clutter.EVENT_STOP;
        });
        let lastScroll = 0;
        screen.connect('scroll-event', (_a, event) => {
            const phone = stream.screen;
            const now = GLib.get_monotonic_time();
            const direction = event.get_scroll_direction();
            if (!phone || now - lastScroll < 200000 || (direction !== Clutter.ScrollDirection.UP && direction !== Clutter.ScrollDirection.DOWN))
                return Clutter.EVENT_STOP;
            lastScroll = now;
            const x = Math.round(phone.w / 2);
            const y = Math.round(phone.h / 2);
            const d = Math.round(phone.h * 0.25) * (direction === Clutter.ScrollDirection.DOWN ? -1 : 1);
            stream.control?.swipe(x, y, x, y + d, 220);
            return Clutter.EVENT_STOP;
        });
        screen.connect('key-press-event', (_a, event) => {
            const control = stream.control;
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

    // --- without a phone ---------------------------------------------------------------------------------

    _text(text, style) {
        const label = new St.Label({text, style_class: style, x_align: Clutter.ActorAlign.CENTER});
        label.clutter_text.line_wrap = true;
        label.clutter_text.set_justify(true);
        return label;
    }

    /** The card when there is no phone to show: install adb, start, the QR code, or "in its own window". */
    _buildMessage(root) {
        root.destroy_all_children();
        const state = this._phone?.state ?? {};
        const box = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, style_class: 'osmin-phone-center'});
        root.add_child(box);
        const close = createButton({iconName: 'go-up-symbolic', styleClass: 'osmin-phone-control', onClick: () => this._onDismiss()});
        close.set({x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START});
        root.add_child(close);

        const icon = name => box.add_child(new St.Icon({icon_name: name, style_class: 'osmin-phone-bigicon', x_align: Clutter.ActorAlign.CENTER}));
        if (!state.adb) {
            icon('phone-symbolic');
            box.add_child(this._text('Install adb first', 'osmin-phone-title'));
            box.add_child(this._text('adb is the standard Android tool that talks to the phone.', 'osmin-phone-note'));
            box.add_child(new St.Label({text: 'sudo apt install adb', style_class: 'osmin-phone-code', x_align: Clutter.ActorAlign.CENTER}));
        } else if (state.mirroring) {
            icon('preferences-system-windows-symbolic');
            box.add_child(this._text('The phone is in its own window', 'osmin-phone-title'));
            box.add_child(pill('Bring it back here', () => this._phone.call('stopMirror').catch(() => {}), true));
        } else if (this.device && !this.device.screen) {
            icon('phone-symbolic');
            box.add_child(this._text(`Opening ${this.device.model || 'the phone'}…`, 'osmin-phone-title'));
        } else if (state.pairing) {
            const qr = new QrCode(scaled(188));
            qr.setText(state.pairing.text);
            box.add_child(qr);
            box.add_child(this._text(state.pairing.message || (state.pairing.status === 'waiting' ? 'Waiting for the phone…' : ''), 'osmin-phone-title'));
            box.add_child(this._text('Settings › Developer options › Wireless debugging › Pair device with QR code, and scan this code with that scanner (not the camera app).', 'osmin-phone-note'));
            const row = new St.BoxLayout({style_class: 'osmin-phone-row', x_align: Clutter.ActorAlign.CENTER});
            if (state.pairing.status === 'failed')
                row.add_child(pill('Try again', () => this._phone.call('startPairing').catch(() => {}), true));
            row.add_child(pill('Cancel', () => this._phone.call('cancelPairing').catch(() => {})));
            box.add_child(row);
        } else {
            icon('phone-symbolic');
            box.add_child(this._text('Your phone on this screen', 'osmin-phone-title'));
            box.add_child(this._text('See it, tap, swipe and type with the mouse and the keyboard. Android 11 or newer, on the same Wi-Fi.', 'osmin-phone-note'));
            box.add_child(pill('Show the QR code', () => this._phone.call('startPairing').catch(() => {}), true));
        }
    }
}
