import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {LiveActivity} from '../ui/liveActivity.js';

/** Files being added to the tray: a peek only (not ongoing). */
export class FilesActivity extends LiveActivity {
    constructor() {
        super({id: 'files', widgetId: 'tray'});
        this.count = 0;
        this.done = false;
    }

    /** @param {number} count @param {boolean} done */
    setProgress(count, done) {
        this.count = count;
        this.done = done;
        this.notifyChanged();
    }

    get title() {
        return this.text;
    }

    get text() {
        const files = this.count === 1 ? '1 file' : `${this.count} files`;
        if (!this.done)
            return `Adding ${files}…`;
        return this.count === 0 ? 'Already in Osmin' : `Added ${files}`;
    }

    get peekSize() {
        return {width: 300, height: 46};
    }

    createCompactParts() {
        throw new Error('the files activity has no compact view');
    }

    createPeekView() {
        const box = new St.BoxLayout({
            style_class: 'osmin-peek',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const badge = new St.Bin({
            style_class: 'osmin-peek-badge',
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({style_class: 'osmin-peek-badge-icon'}),
        });
        box.add_child(badge);
        const label = new St.Label({
            style_class: 'osmin-peek-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(label);

        const refresh = () => {
            label.text = this.text;
            badge.get_child().icon_name = this.done ? 'object-select-symbolic' : 'folder-download-symbolic';
        };
        this.connectObject('changed', refresh, box);
        box.connect('destroy', () => this.disconnectObject(box));
        refresh();
        return box;
    }
}
