import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {DEFAULT_WIDGETS, MENU_WIDGET_IDS, WIDGET_INFO} from '../utils/widgetInfo.js';

export const DEFAULTS = Object.freeze({
    'size-scale': 1.0,
    'corner-radius': 32,
    'background-opacity': 0.96,
    'animation-speed': 1.0,
    'localsend-receive': false,
    'free-super-v': false,
    'saved-message-tray-binding': [],
    'open-on-hover': true,
    'auto-collapse': true,
    'activities-in-collapsed': true,
    'monitors': ['primary'],
    'shortcut-osmin': [],
    'shortcut-tray': [],
    'shortcut-clipboard': [],
    'shortcut-alerts': [],
    'shortcut-command': [],
    'enabled-widgets': [...DEFAULT_WIDGETS],
    'widget-cells': Object.fromEntries(WIDGET_INFO.map(w => [w.id, w.cells])),
    'width-mode': 'auto',
    'fixed-width': 0.4,
    'row-height': 112,
    'content-padding': 16,
    'widget-spacing': 16,
    'show-dividers': true,
    'shadow-strength': 0.6,
    'gestures-swipe-open': true,
    'gestures-swipe-close': true,
    'gestures-media-swipe': true,
    'gestures-invert': false,
    'gestures-middle-click': 'activity',
    'shortcut-apps': [],
    'shortcut-columns': 1,
    'collapsed-width-adjust': 0,
    'clipboard-keep-history': false,
    'clipboard-clean-urls': false,
    'show-input-source': true,
    'show-caps-lock': true,
    'show-lyrics': false,
    'clipboard-max-items': 30,
    'clipboard-click-pastes': true,
    'panel-color': '#000000',
    'panel-opacity': 0.5,
    'tray-keep-files': true,
    'album-corner-radius': 10,
    'media-effect': 'bars',
    'colored-effects': true,
    'activity-media': true,
    'system-alerts': true,
    'agents-alerts': true,
    'activity-downloads': true,
    'activity-timer': true,
    'desktops-per-monitor': false,
    'monitor-interval': 2,
    'temp-unit': 'C',
    'bar-metrics': [],
    'alert-cpu': 90,
    'alert-temp': 85,
    'alert-disk': 5,
    'alert-battery': 20,
    'alert-memory': 8,
    'system-blocks': ['temps', 'cpu', 'gpu', 'memory', 'uptime'],
    'graph-scale': true,
    'color-scheme': 'system',
    'bar-icon': 'view-app-grid-symbolic',
    'awake-icon': 'weather-clear-night-symbolic',
    'awake-color': '#ff9500',
    'menu-hidden': [],
    'menu-order': [],
    'activity-calendar': true,
    'activity-files': true,
    'peek-media-seconds': 1.5,
    'peek-files-seconds': 1.5,
    'peek-calendar-seconds': 6.0,
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

    /** The underlying Gio.Settings (null without a compiled schema). */
    get gsettings() {
        return this._settings;
    }

    get available() {
        return this._settings !== null;
    }

    get(key) {
        if (!this._settings)
            return DEFAULTS[key];
        try {
            return this._settings.get_value(key).recursiveUnpack();
        } catch (e) {
            console.warn(`[osmin] reading setting ${key} failed: ${e.message}`);
            return DEFAULTS[key];
        }
    }

    /** The ids of the enabled widgets in the order the user chose; never empty. */
    get enabledWidgets() {
        const known = new Set(WIDGET_INFO.map(w => w.id));
        const ids = [];
        let stored = [...this.get('enabled-widgets')];
        // The old Quick Toggles page became four pages: Keep awake, Displays, Utilities and Quick toggles.
        if (stored.includes('tools')) {
            stored = stored.flatMap(id => id === 'tools' ? ['awake', 'displays', 'utilities', 'toggles'] : [id]);
            if (!stored.includes('controls'))
                stored.push('controls');
        }
        for (const id of stored) {
            if (known.has(id) && !ids.includes(id))
                ids.push(id);
        }
        return ids.length > 0 ? ids : [...DEFAULT_WIDGETS];
    }

    /** The enabled widgets that sit in the capsule, in order. */
    get islandWidgets() {
        const ids = this.enabledWidgets.filter(id => !MENU_WIDGET_IDS.includes(id));
        return ids.length > 0 ? ids : DEFAULT_WIDGETS.filter(id => !MENU_WIDGET_IDS.includes(id));
    }

    /** The enabled widgets that are pages of the top-bar button's window, in order. */
    get menuWidgets() {
        return this.enabledWidgets.filter(id => MENU_WIDGET_IDS.includes(id));
    }

    /** Width of a widget in cells. */
    cellsFor(id) {
        const info = WIDGET_INFO.find(w => w.id === id);
        const value = Number(this.get('widget-cells')?.[id]);
        return Number.isFinite(value) && value > 0 ? Math.round(value) : (info?.cells ?? 4);
    }

    destroy() {
        if (this._id)
            this._settings.disconnect(this._id);
        this._id = 0;
        this._settings = null;
    }
}
