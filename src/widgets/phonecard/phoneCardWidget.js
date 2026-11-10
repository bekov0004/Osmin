import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {PhoneCardActivity} from '../../phone/phoneCard.js';
import {reachable} from '../../phone/phoneFinder.js';
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
        this._settings = context.settings;
        this._near = false;          // the phone of the Osmin Phone app answers on the network
        this._big = new PhoneCardActivity({
            phone: this._phone,
            ui: this._ui,
            settings: context.settings,
            onDismiss: () => this._shrink(),
            onResize: () => this._reopen(),
            onChange: () => this._update(),
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
        this._probe();
    }

    /** Whether the phone of the app is around (its server answers), for the tile's words. */
    async _probe() {
        const host = this._settings?.gsettings?.get_string('phone-last-host');
        if (!host || !this._big.knownAppPhone || this._probing)
            return;
        this._probing = true;
        try {
            this._near = await reachable(host);
        } catch (e) {
            this._near = false;
        }
        this._probing = false;
        this._update();
    }

    _update() {
        if (!this._view)
            return;
        const state = this._phone?.state ?? {};
        const device = this._big.device;
        const known = this._big.knownAppPhone;
        this._title.text = device ? (device.model || 'Phone') : known ?? 'Phone';
        if (state.mirroring)
            this._subtitle.text = 'In a window';
        else if (device || (known && this._near))
            this._subtitle.text = 'Tap to open';
        else if (known)
            this._subtitle.text = 'Tap to connect';
        else
            this._subtitle.text = state.adb ? 'Tap to connect' : 'Tap to set up';
    }

    _open() {
        // A phone of the app that was connected before: straight to it (adb's phone, when there is one, comes first).
        const adbPhone = (this._phone?.state?.devices ?? []).some(d => d.state === 'device');
        if (!adbPhone)
            this._big.openKnownPhone();
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
