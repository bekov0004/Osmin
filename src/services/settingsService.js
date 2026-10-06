import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {WIDGET_INFO} from '../utils/widgetInfo.js';

export const DEFAULTS = Object.freeze({
    'size-scale': 1.0,
    'corner-radius': 36,
    'background-opacity': 0.96,
    'animation-speed': 1.0,
    'open-on-hover': true,
    'auto-collapse': true,
    'activities-in-collapsed': true,
    'enabled-widgets': WIDGET_INFO.map(w => w.id),
});

/**
 * Typed access to the extension's GSettings (the preferences window writes
 * them). If the schema is not installed (a hand-copied extension without
 * compiled schemas) it falls back to the defaults, so Osmin still works.
 *
 * Signal: 'changed' (key).
 */
export class SettingsService extends Signals.EventEmitter {
    /** @param {Gio.Settings|null} gsettings */
    constructor(gsettings) {
        super();
        this._settings = gsettings;
        this._id = gsettings?.connect('changed', (_s, key) => this.emit('changed', key)) ?? 0;
    }

    get available() {
        return this._settings !== null;
    }

    get(key) {
        if (!this._settings)
            return DEFAULTS[key];
        try {
            switch (typeof DEFAULTS[key]) {
            case 'boolean':
                return this._settings.get_boolean(key);
            case 'number':
                return Number.isInteger(DEFAULTS[key]) && key === 'corner-radius'
                    ? this._settings.get_int(key) : this._settings.get_double(key);
            default:
                return this._settings.get_strv(key);
            }
        } catch (e) {
            console.warn(`[osmin] reading setting ${key} failed: ${e.message}`);
            return DEFAULTS[key];
        }
    }

    /** The ids of the enabled widgets, in display order; never empty. */
    get enabledWidgets() {
        const wanted = new Set(this.get('enabled-widgets'));
        const ids = WIDGET_INFO.map(w => w.id).filter(id => wanted.has(id));
        return ids.length > 0 ? ids : WIDGET_INFO.map(w => w.id);
    }

    destroy() {
        if (this._id)
            this._settings.disconnect(this._id);
        this._id = 0;
        this._settings = null;
    }
}
