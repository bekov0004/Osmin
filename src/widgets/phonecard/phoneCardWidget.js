import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {PhoneCardActivity} from '../../phone/phoneCard.js';
import {createButton} from '../../ui/button.js';
import {Priority} from '../../utils/events.js';
import {OsminWidget} from '../widget.js';

const LEASE_RENEW_S = 5;

/**
 * Phone: a tile in the capsule for your Android phone. Click it (or its enlarge button) and the card
 * grows out of the capsule with the phone's screen in it, as tall as the phone; a QR code connects
 * a phone first. The card can be taken out into a window and brought back.
 */
export class PhoneCardWidget extends OsminWidget {
    static id = 'phonecard';
    static title = 'Phone';
    static iconName = 'phone-symbolic';

    constructor(context) {
        super(context);
        this._phone = context.services.backend?.phone;
        this._ui = context.ui;
        this._renewId = 0;
        this._reopenId = 0;
        this._big = new PhoneCardActivity({
            phone: this._phone,
            ui: this._ui,
            onDismiss: () => this._shrink(),
            onResize: () => this._reopen(),
        });
    }

    start() {
        // The card asks the capsule to show the phone again when the window's own button says so.
        this._phone?.connectObject('event', (_m, name) => name === 'dock' && this._open(), this);
        this._phone?.connectObject('state-changed', () => this._update(), this);
    }

    createView() {
        const root = new St.Widget({layout_manager: new Clutter.BinLayout(), style_class: 'osmin-widget osmin-phonecard', x_expand: true, y_expand: true, reactive: true, track_hover: true});
        const column = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        column.add_child(new St.Icon({icon_name: 'phone-symbolic', style_class: 'osmin-phonecard-icon', x_align: Clutter.ActorAlign.CENTER}));
        this._title = new St.Label({style_class: 'osmin-phonecard-title', x_align: Clutter.ActorAlign.CENTER});
        this._subtitle = new St.Label({style_class: 'osmin-phonecard-subtitle', x_align: Clutter.ActorAlign.CENTER});
        column.add_child(this._title);
        column.add_child(this._subtitle);
        root.add_child(column);

        root.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            this._open();
            return Clutter.EVENT_STOP;
        });
        const enlarge = createButton({iconName: 'view-fullscreen-symbolic', styleClass: 'osmin-mirror-control', onClick: () => this._open()});
        enlarge.set({x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START});
        enlarge.opacity = 0;
        root.add_child(enlarge);
        root.connect('notify::hover', () =>
            enlarge.ease({opacity: root.hover ? 255 : 0, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD}));
        return root;
    }

    onViewCreated() {
        this._update();
    }

    onPageShown() {
        this._lease();
        if (!this._renewId) {
            this._renewId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, LEASE_RENEW_S, () => {
                this._lease();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    onPageHidden() {
        if (this._renewId)
            GLib.source_remove(this._renewId);
        this._renewId = 0;
        this._phone?.call('watch', {on: false}).catch(() => {});
    }

    _lease() {
        this._phone?.call('watch', {on: true}).catch(() => {});
    }

    _update() {
        if (!this._view)
            return;
        const state = this._phone?.state ?? {};
        const device = this._big.device;
        this._title.text = device ? (device.model || 'Phone') : 'Phone';
        this._subtitle.text = !state.adb ? 'adb is missing' : state.mirroring ? 'In a window' : device ? 'Tap to open' : 'Tap to connect';
    }

    _open() {
        this._ui.showCard(this._big, {persistent: true, priority: Priority.HIGH});
    }

    _shrink() {
        this._ui.hideCard(this._big);
    }

    /** The card's size depends on the phone: show it again with the new one. */
    _reopen() {
        this._shrink();
        if (this._reopenId)
            GLib.source_remove(this._reopenId);
        this._reopenId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 320, () => {
            this._reopenId = 0;
            this._open();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this.onPageHidden();
        if (this._reopenId)
            GLib.source_remove(this._reopenId);
        this._phone?.disconnectObject(this);
        this._big.destroy();
        super.destroy();
    }
}
