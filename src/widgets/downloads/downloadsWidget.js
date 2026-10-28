import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {formatBytes, formatRate} from '../../services/systemService.js';
import {createButton} from '../../ui/button.js';
import {Priority} from '../../utils/events.js';
import {OsminWidget} from '../widget.js';
import {DownloadsActivity} from './downloadsActivity.js';

/**
 * Downloads: what is arriving in the Downloads folder and what arrived lately. A click opens a
 * file. While something downloads it shows in the capsule, and a card tells when it is done.
 */
export class DownloadsWidget extends OsminWidget {
    static id = 'downloads';
    static title = 'Downloads';
    static iconName = 'folder-download-symbolic';

    constructor(context) {
        super(context);
        this._downloads = context.services.downloads;
        this._files = context.services.files;
        this._activities = context.services.activities;
        this._settings = context.settings;
        this._activity = null;
    }

    start() {
        this._activity = new DownloadsActivity({downloads: this._downloads});
        this._downloads.connectObject(
            'changed', () => this._onChanged(),
            'finished', (_d, info) => this._onFinished(info),
            this);
        this._onChanged();
    }

    syncActivity() {
        this._onChanged();
    }

    _onChanged() {
        if (this._activity) {
            this._activity.notifyChanged();
            if (this._downloads.active.length > 0 && this._settings.get('activity-downloads')) {
                this._activity.finished = null;
                this._activities.start(this._activity);
            } else {
                this._activities.end('downloads');
            }
        }
        this._rebuild();
    }

    _onFinished(info) {
        if (!this._activity || !this._settings.get('activity-downloads'))
            return;
        this._activity.finished = {name: info.name, size: info.size};
        this._activity.notifyChanged();
        this._activities.peek(this._activity, {duration: 4500, priority: Priority.NORMAL});
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-downloads', x_expand: true, y_expand: true});
        root.add_child(new St.Label({text: 'DOWNLOADS', style_class: 'osmin-todo-caption'}));
        this._empty = new St.Label({text: 'Nothing downloaded yet', style_class: 'osmin-todo-empty', x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        root.add_child(this._empty);
        this._scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true, x_expand: true, y_expand: true});
        this._list = new St.BoxLayout({vertical: true, x_expand: true});
        this._scroll.add_child(this._list);
        root.add_child(this._scroll);
        return root;
    }

    onViewCreated() {
        this._rebuild();
    }

    _rebuild() {
        if (!this._view)
            return;
        const items = this._downloads.items;
        this._empty.visible = items.length === 0;
        this._scroll.visible = items.length > 0;
        this._list.destroy_all_children();
        for (const item of items) {
            const row = new St.BoxLayout({style_class: 'osmin-download', x_expand: true});
            const button = new St.Button({style_class: 'osmin-download-main', x_expand: true, can_focus: true, reactive: item.state === 'done'});
            const line = new St.BoxLayout({x_expand: true});
            line.add_child(new St.Icon({
                icon_name: item.state === 'done' ? 'emblem-ok-symbolic' : 'folder-download-symbolic',
                style_class: 'osmin-download-icon',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            const name = new St.Label({text: item.name, style_class: 'osmin-download-name', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            name.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
            line.add_child(name);
            line.add_child(new St.Label({
                text: item.state === 'done' ? formatBytes(item.size) : `${formatBytes(item.size)}${item.speed > 1024 ? ` · ${formatRate(item.speed)}` : ''}`,
                style_class: 'osmin-download-size',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            button.set_child(line);
            button.connect('clicked', () => this._files.open(Gio.File.new_for_path(item.path).get_uri()));
            row.add_child(button);
            if (item.state === 'done') {
                row.add_child(createButton({
                    iconName: 'folder-open-symbolic',
                    styleClass: 'osmin-ls-file-remove',
                    onClick: () => this._files.showInFolder(Gio.File.new_for_path(item.path).get_uri()),
                }));
            }
            this._list.add_child(row);
        }
    }

    destroy() {
        this._downloads.disconnectObject(this);
        if (this._activity)
            this._activities.end('downloads');
        this._activity?.destroy();
        super.destroy();
    }
}
