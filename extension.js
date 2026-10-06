import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Osmin} from './src/osmin.js';
import {SettingsService} from './src/services/settingsService.js';

export default class OsminExtension extends Extension {
    enable() {
        let gsettings = null;
        try {
            gsettings = this.getSettings();
        } catch (e) {
            // e.g. a hand-copied extension without compiled schemas: use the defaults.
            console.warn(`[osmin] settings unavailable, using defaults: ${e.message}`);
        }
        this._settings = new SettingsService(gsettings);
        this._osmin = new Osmin(this._settings, {openPreferences: () => this.openPreferences()});
        this._osmin.enable();
    }

    disable() {
        this._osmin?.destroy();
        this._osmin = null;
        this._settings?.destroy();
        this._settings = null;
    }
}
