import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {LiveActivity} from './liveActivity.js';

const SHOW_MS = 1400;
const PRIORITY = 100; // above everything: it only lasts a moment

/**
 * A short indicator in the capsule itself (the keyboard layout, Caps Lock ...): the collapsed
 * capsule widens to both sides and shows an icon on the left and a word on the right, then
 * shrinks back. A new indicator while one is showing replaces it (nothing piles up).
 */
export class IndicatorActivity extends LiveActivity {
    /** @param {ActivityManager} activities */
    constructor(activities) {
        super({id: 'indicator', widgetId: 'osmin', compactPriority: PRIORITY});
        this._activities = activities;
        this.iconName = 'input-keyboard-symbolic';
        this.text = '';
        this._timer = 0;
    }

    get title() {
        return this.text;
    }

    /** @param {{icon: string, text: string, duration?: number}} indicator */
    show({icon, text, duration = SHOW_MS}) {
        this.iconName = icon;
        this.text = text;
        this.notifyChanged();
        this._activities.start(this);
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
            this._timer = 0;
            this._activities.end(this.id);
            return GLib.SOURCE_REMOVE;
        });
    }

    createCompactParts() {
        const icon = new St.Icon({icon_name: this.iconName, style_class: 'osmin-compact-icon', y_align: Clutter.ActorAlign.CENTER, style: 'margin: 0 22px 0 18px;'});
        const label = new St.Label({text: this.text, style_class: 'osmin-compact-label', y_align: Clutter.ActorAlign.CENTER, style: 'margin: 0 18px 0 22px; min-width: 64px;'});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.connectObject('changed', () => {
            icon.icon_name = this.iconName;
            label.text = this.text;
        }, label);
        label.connect('destroy', () => this.disconnectObject(label));
        return {left: icon, right: label};
    }

    // Hovering the capsule shows an activity's card: for this one it is just the same words.
    createPeekView() {
        const label = new St.Label({text: this.text, style_class: 'osmin-compact-label', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this.connectObject('changed', () => {
            label.text = this.text;
        }, label);
        label.connect('destroy', () => this.disconnectObject(label));
        return label;
    }

    destroy() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
    }
}
