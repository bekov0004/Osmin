import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {formatBytes, formatRate} from '../../services/systemService.js';
import {LiveActivity, createCompactParts} from '../../ui/liveActivity.js';

/** Ongoing while something is being downloaded; peeks when a download finishes. */
export class DownloadsActivity extends LiveActivity {
    constructor({downloads}) {
        super({id: 'downloads', widgetId: 'downloads', compactPriority: 15});
        this._downloads = downloads;
        this.finished = null; // {name, size} of the download that just finished
    }

    get title() {
        return this.finished ? 'Downloaded' : 'Downloading';
    }

    get text() {
        const active = this._downloads.active;
        if (active.length === 0)
            return this.finished ? this.finished.name : '';
        const speed = active.reduce((sum, item) => sum + item.speed, 0);
        const size = active.reduce((sum, item) => sum + item.size, 0);
        return `↓ ${speed > 1024 ? formatRate(speed) : formatBytes(size)}`;
    }

    get peekSize() {
        return {width: 340, height: 56};
    }

    createCompactParts() {
        return createCompactParts(this, 'folder-download-symbolic', () => this.text);
    }

    createPeekView() {
        const box = new St.BoxLayout({style_class: 'osmin-peek', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        box.add_child(new St.Bin({
            style_class: 'osmin-peek-badge',
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'folder-download-symbolic', style_class: 'osmin-peek-badge-icon'}),
        }));
        const texts = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'osmin-peek-texts'});
        const title = new St.Label({style_class: 'osmin-peek-title'});
        const subtitle = new St.Label({style_class: 'osmin-peek-subtitle'});
        texts.add_child(title);
        texts.add_child(subtitle);
        box.add_child(texts);
        const refresh = () => {
            title.text = this.finished && this._downloads.active.length === 0 ? `Downloaded · ${formatBytes(this.finished.size)}` : 'Downloading';
            subtitle.text = this.text;
        };
        this.connectObject('changed', refresh, box);
        box.connect('destroy', () => this.disconnectObject(box));
        refresh();
        return box;
    }
}
