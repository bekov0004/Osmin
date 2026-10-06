import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {WIDGET_INFO} from './src/utils/widgetInfo.js';

export default class OsminPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(640, 780);

        const page = new Adw.PreferencesPage({
            title: _('Osmin'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // --- Appearance
        const appearance = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('Changes apply immediately.'),
        });
        page.add(appearance);

        const spin = (key, title, subtitle, lower, upper, step, digits = 0) => {
            const row = new Adw.SpinRow({
                title,
                subtitle,
                digits,
                adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            appearance.add(row);
        };
        spin('size-scale', _('Panel size'), _('Width of the expanded capsule (1.00 is the default)'), 0.85, 1.25, 0.05, 2);
        spin('corner-radius', _('Corner radius'), _('In pixels'), 8, 44, 1);
        spin('background-opacity', _('Background opacity'), _('1.00 is fully opaque'), 0.5, 1.0, 0.02, 2);
        spin('animation-speed', _('Animation speed'), _('Higher is faster'), 0.5, 2.0, 0.1, 1);

        // --- Behaviour
        const behaviour = new Adw.PreferencesGroup({title: _('Behaviour')});
        page.add(behaviour);
        const toggle = (key, title, subtitle) => {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            behaviour.add(row);
        };
        toggle('open-on-hover', _('Open on hover'), _('Off: the capsule opens on click only'));
        toggle('auto-collapse', _('Collapse when the pointer leaves'), _('Off: it stays open until you close it'));
        toggle('activities-in-collapsed', _('Show activities when collapsed'),
            _('A running timer, music or a meeting instead of the time'));

        // --- Widgets
        const widgets = new Adw.PreferencesGroup({
            title: _('Widgets'),
            description: _('At least one widget stays enabled.'),
        });
        page.add(widgets);

        const rows = new Map();
        const syncRows = () => {
            const enabled = new Set(settings.get_strv('enabled-widgets'));
            for (const [id, row] of rows) {
                row._updating = true;
                row.active = enabled.has(id);
                row._updating = false;
                // The last enabled widget cannot be switched off.
                row.sensitive = !(enabled.size <= 1 && enabled.has(id));
            }
        };
        for (const info of WIDGET_INFO) {
            const row = new Adw.SwitchRow({title: _(info.title), subtitle: _(info.subtitle)});
            row.connect('notify::active', () => {
                if (row._updating)
                    return;
                const enabled = new Set(settings.get_strv('enabled-widgets'));
                if (row.active)
                    enabled.add(info.id);
                else if (enabled.size > 1)
                    enabled.delete(info.id);
                settings.set_strv('enabled-widgets', WIDGET_INFO.map(w => w.id).filter(id => enabled.has(id)));
            });
            rows.set(info.id, row);
            widgets.add(row);
        }
        settings.connect('changed::enabled-widgets', syncRows);
        syncRows();

        // --- Reset
        const reset = new Adw.PreferencesGroup();
        page.add(reset);
        const resetRow = new Adw.ActionRow({title: _('Reset all settings')});
        const button = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        button.connect('clicked', () => {
            for (const key of settings.list_keys())
                settings.reset(key);
        });
        resetRow.add_suffix(button);
        reset.add(resetRow);
    }
}
