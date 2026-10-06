import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Osmin} from './src/osmin.js';

export default class OsminExtension extends Extension {
    enable() {
        this._osmin = new Osmin();
        this._osmin.enable();
    }

    disable() {
        this._osmin?.destroy();
        this._osmin = null;
    }
}
