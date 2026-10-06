import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {OsminWidget} from '../widget.js';
import {FileItem} from './fileItem.js';
import {FilesActivity} from './filesActivity.js';

const COLUMNS = 2;

/**
 * The file shelf: files dropped on the capsule stay here until removed.
 * (Files can be opened, shown in the file manager, copied to the clipboard
 * for pasting elsewhere, or removed from the tray.)
 */
export class FilesWidget extends OsminWidget {
    static id = 'files';
    static title = 'Files';
    static iconName = 'folder-symbolic';

    constructor(context) {
        super(context);
        this._files = context.services.files;
        this._activities = context.services.activities;
        this._activity = null;
    }

    /** Peeks "Adding N files…" / "Added N files" when files are dropped on the capsule. */
    start() {
        this._activity = new FilesActivity();
        this._files.connectObject(
            'adding', (_service, count) => {
                this._activity.setProgress(count, false);
                this._activities.peek(this._activity, {duration: 6000});
            },
            'added', (_service, count) => {
                this._activity.setProgress(count, true);
                this._activities.peek(this._activity, {duration: 2500});
            },
            this);
    }

    createView() {
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-widget osmin-files',
            x_expand: true,
            y_expand: true,
        });

        const header = new St.BoxLayout({style_class: 'osmin-files-header'});
        this._caption = new St.Label({
            style_class: 'osmin-files-caption',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._caption);
        this._clearButton = new St.Button({
            label: 'Clear',
            style_class: 'osmin-files-clear',
            can_focus: true,
        });
        this._clearButton.connect('clicked', () => this._files.clear());
        header.add_child(this._clearButton);
        root.add_child(header);

        this._empty = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-files-empty',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._empty.add_child(new St.Icon({
            icon_name: 'folder-download-symbolic',
            style_class: 'osmin-placeholder-icon',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        this._empty.add_child(new St.Label({
            text: 'Drop files here',
            style_class: 'osmin-placeholder-title',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        root.add_child(this._empty);

        this._scroll = new St.ScrollView({
            style_class: 'osmin-files-scroll',
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        this._grid = new St.BoxLayout({vertical: true, style_class: 'osmin-files-grid', x_expand: true});
        this._scroll.add_child(this._grid);
        root.add_child(this._scroll);

        this._files.connectObject('changed', () => this._rebuild(), this);
        this._rebuild();
        return root;
    }

    destroy() {
        this._files.disconnectObject(this);
        this._activity?.destroy();
        super.destroy();
    }

    _rebuild() {
        const items = this._files.items;
        this._caption.text = items.length > 0 ? `FILES · ${items.length}` : 'FILES';
        this._clearButton.visible = items.length > 0;
        this._empty.visible = items.length === 0;
        this._scroll.visible = items.length > 0;

        this._grid.destroy_all_children();
        for (let i = 0; i < items.length; i += COLUMNS) {
            const row = new St.BoxLayout({style_class: 'osmin-files-row', x_expand: true});
            for (const item of items.slice(i, i + COLUMNS)) {
                row.add_child(new FileItem({
                    item,
                    onOpen: uri => this._files.open(uri),
                    onShowInFolder: uri => this._files.showInFolder(uri),
                    onCopy: uri => this._files.copyToClipboard([uri]),
                    onRemove: uri => this._files.remove(uri),
                }));
            }
            // Keep a lone item at the width of a column.
            for (let pad = row.get_n_children(); pad < COLUMNS; pad++)
                row.add_child(new St.Widget({x_expand: true}));
            this._grid.add_child(row);
        }
    }
}
