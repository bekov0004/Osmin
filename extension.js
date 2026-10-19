import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {OsminHost} from './src/osminHost.js';
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
        this._osmin = new OsminHost(this._settings, {openPreferences: () => this.openPreferences()});
        this._osmin.enable();
    }

    disable() {
        this._osmin?.destroy();
        this._osmin = null;
        this._settings?.destroy();
        this._settings = null;
    }
}
