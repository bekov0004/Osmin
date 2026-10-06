import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {OsminWidget} from '../widget.js';

const ROWS = 2;

/** Quick launchers: the apps you picked in the settings, two rows per column. */
export class ShortcutsWidget extends OsminWidget {
    static id = 'shortcuts';
    static title = 'Shortcuts';
    static iconName = 'view-app-grid-symbolic';

    constructor(context) {
        super(context);
        this._settings = context.settings;
        this._ui = context.ui;
    }

    createView() {
        this._root = new St.BoxLayout({
            style_class: 'osmin-widget osmin-shortcuts',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._settings.connectObject('changed', (_s, key) => {
            if (key === 'shortcut-apps' || key === 'shortcut-columns')
                this._rebuild();
        }, this);
        return this._root;
    }

    onViewCreated() {
        this._rebuild();
    }

    destroy() {
        this._settings.disconnectObject(this);
        super.destroy();
    }

    _apps() {
        const apps = [];
        for (const id of this._settings.get('shortcut-apps')) {
            const app = Gio.DesktopAppInfo.new(id);
            if (app)
                apps.push(app);
        }
        return apps;
    }

    _rebuild() {
        if (!this._root)
            return;
        this._root.destroy_all_children();
        const columns = Math.max(1, Math.min(2, this._settings.get('shortcut-columns')));
        const apps = this._apps().slice(0, columns * ROWS);

        if (apps.length === 0) {
            const empty = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'osmin-shortcuts-empty',
            });
            empty.add_child(new St.Icon({
                icon_name: 'view-app-grid-symbolic',
                style_class: 'osmin-shortcuts-empty-icon',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            empty.add_child(new St.Label({
                text: 'No shortcuts yet',
                style_class: 'osmin-shortcuts-empty-text',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            empty.add_child(new St.Label({
                text: 'Choose apps in the settings',
                style_class: 'osmin-shortcuts-empty-hint',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            this._root.add_child(empty);
            return;
        }

        for (let c = 0; c < columns; c++) {
            const column = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'osmin-shortcuts-column'});
            for (const app of apps.slice(c * ROWS, (c + 1) * ROWS))
                column.add_child(this._tile(app, columns > 1));
            if (column.get_n_children() > 0)
                this._root.add_child(column);
        }
    }

    _tile(app, stacked) {
        const button = new St.Button({
            style_class: 'osmin-shortcut',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            y_expand: true,
        });
        const row = new St.BoxLayout({
            vertical: stacked,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: stacked ? 'osmin-shortcut-row osmin-shortcut-stacked' : 'osmin-shortcut-row',
        });
        row.add_child(new St.Icon({
            gicon: app.get_icon(),
            style_class: 'osmin-shortcut-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const label = new St.Label({
            text: app.get_name(),
            style_class: stacked ? 'osmin-shortcut-label osmin-shortcut-label-small' : 'osmin-shortcut-label',
            x_align: stacked ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        row.add_child(label);
        button.set_child(row);
        button.connect('clicked', () => this._launch(app));
        return button;
    }

    _launch(app) {
        try {
            app.launch([], global.create_app_launch_context(0, -1));
        } catch (e) {
            console.warn(`[osmin] could not start ${app.get_id()}: ${e.message}`);
        }
        this._ui?.closeCapsule?.();
    }
}
