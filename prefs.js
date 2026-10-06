import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {DEFAULT_WIDGETS, WIDGET_INFO} from './src/utils/widgetInfo.js';

const PREVIEW_CSS = `
.osmin-preview {
    background-color: #0e0e10;
    border-radius: 0 0 28px 28px;
    padding: 12px 14px 14px 14px;
    min-height: 74px;
}
.osmin-preview-block {
    background-color: rgba(255, 255, 255, 0.10);
    border-radius: 12px;
    color: white;
    font-weight: 700;
    min-height: 54px;
}
.osmin-preview-block label { color: white; }
.osmin-preview-empty { color: rgba(255, 255, 255, 0.5); }
`;

export default class OsminPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(720, 820);

        const provider = new Gtk.CssProvider();
        provider.load_from_string(PREVIEW_CSS);
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        window.add(this._generalPage(settings));
        window.add(this._widgetsPage(settings));
        window.add(this._appearancePage(settings));
        window.add(this._trayPage(settings));
        window.add(this._activitiesPage(settings));
    }

    // --- helpers ----------------------------------------------------------

    _page(title, icon, name) {
        return new Adw.PreferencesPage({title, icon_name: icon, name});
    }

    _spin(settings, key, title, subtitle, [lower, upper, step], digits = 0) {
        const row = new Adw.SpinRow({
            title,
            subtitle,
            digits,
            adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}),
        });
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _toggle(settings, key, title, subtitle = '') {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _resetGroup(settings, keys) {
        const group = new Adw.PreferencesGroup();
        const row = new Adw.ActionRow({title: _('Reset these settings')});
        const button = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        button.connect('clicked', () => keys.forEach(key => settings.reset(key)));
        row.add_suffix(button);
        group.add(row);
        return group;
    }

    // --- General ----------------------------------------------------------

    _generalPage(settings) {
        const page = this._page(_('General'), 'preferences-system-symbolic', 'general');

        const behaviour = new Adw.PreferencesGroup({title: _('Behaviour')});
        behaviour.add(this._toggle(settings, 'open-on-hover', _('Open on hover'),
            _('Off: the capsule opens on click only')));
        behaviour.add(this._toggle(settings, 'auto-collapse', _('Collapse when the pointer leaves'),
            _('Off: it stays open until you close it')));
        page.add(behaviour);

        const animation = new Adw.PreferencesGroup({title: _('Animation')});
        animation.add(this._spin(settings, 'animation-speed', _('Animation speed'),
            _('Higher is faster'), [0.5, 2.0, 0.1], 1));
        page.add(animation);

        page.add(this._resetGroup(settings, ['open-on-hover', 'auto-collapse', 'animation-speed']));
        return page;
    }

    // --- Widgets ----------------------------------------------------------

    _widgetsPage(settings) {
        const page = this._page(_('Widgets'), 'view-grid-symbolic', 'widgets');

        // A small picture of the capsule: one block per enabled widget, as wide as its cells.
        const previewGroup = new Adw.PreferencesGroup({
            title: _('Layout'),
            description: _('The expanded capsule grows with its widgets.'),
        });
        const preview = new Gtk.Box({
            css_classes: ['osmin-preview'],
            spacing: 8,
            halign: Gtk.Align.CENTER,
            homogeneous: false,
        });
        previewGroup.add(preview);
        page.add(previewGroup);

        const list = new Adw.PreferencesGroup({
            title: _('Widgets'),
            description: _('Switch widgets on or off, change their order and width (in cells). At least one stays on.'),
        });
        page.add(list);

        const width = new Adw.PreferencesGroup({title: _('Capsule width')});
        const modes = ['auto', 'fixed'];
        const modeRow = new Adw.ComboRow({
            title: _('Width mode'),
            subtitle: _('Auto: follows the widgets. Fixed: a share of the screen'),
            model: Gtk.StringList.new([_('Auto'), _('Fixed')]),
        });
        modeRow.selected = Math.max(0, modes.indexOf(settings.get_string('width-mode')));
        modeRow.connect('notify::selected', () => settings.set_string('width-mode', modes[modeRow.selected]));
        settings.connect('changed::width-mode', () => {
            modeRow.selected = Math.max(0, modes.indexOf(settings.get_string('width-mode')));
        });
        width.add(modeRow);
        const fixed = this._spin(settings, 'fixed-width', _('Fixed width'),
            _('Share of the screen width (fixed mode)'), [0.25, 0.9, 0.05], 2);
        const updateFixed = () => {
            fixed.sensitive = settings.get_string('width-mode') === 'fixed';
        };
        settings.connect('changed::width-mode', updateFixed);
        updateFixed();
        width.add(fixed);
        width.add(this._spin(settings, 'size-scale', _('Widget size'),
            _('Scales the width of every cell'), [0.85, 1.25, 0.05], 2));
        page.add(width);

        // --- model <-> UI
        const readCells = () => {
            const value = settings.get_value('widget-cells').recursiveUnpack();
            return Object.fromEntries(WIDGET_INFO.map(w => [w.id, Number(value[w.id]) || w.cells]));
        };
        const enabled = () => {
            const ids = [];
            for (const id of settings.get_strv('enabled-widgets')) {
                if (WIDGET_INFO.some(w => w.id === id) && !ids.includes(id))
                    ids.push(id);
            }
            return ids.length > 0 ? ids : [...DEFAULT_WIDGETS];
        };
        const saveEnabled = ids => settings.set_strv('enabled-widgets', ids);

        const rebuildPreview = () => {
            let child;
            while ((child = preview.get_first_child()))
                preview.remove(child);
            const cells = readCells();
            for (const id of enabled()) {
                const info = WIDGET_INFO.find(w => w.id === id);
                const block = new Gtk.Box({css_classes: ['osmin-preview-block'], valign: Gtk.Align.CENTER});
                block.set_size_request(cells[id] * 16, -1);
                block.append(new Gtk.Label({label: _(info.title), hexpand: true, wrap: true}));
                preview.append(block);
            }
        };

        const rows = [];
        const rebuildRows = () => {
            rows.forEach(row => list.remove(row));
            rows.length = 0;
            const on = enabled();
            const ordered = [...on, ...WIDGET_INFO.map(w => w.id).filter(id => !on.includes(id))];
            const cells = readCells();

            ordered.forEach(id => {
                const info = WIDGET_INFO.find(w => w.id === id);
                const isOn = on.includes(id);
                const row = new Adw.ActionRow({title: _(info.title), subtitle: _(info.subtitle)});

                const up = new Gtk.Button({
                    icon_name: 'go-up-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                    sensitive: isOn && on.indexOf(id) > 0,
                    tooltip_text: _('Move left'),
                });
                const down = new Gtk.Button({
                    icon_name: 'go-down-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                    sensitive: isOn && on.indexOf(id) < on.length - 1,
                    tooltip_text: _('Move right'),
                });
                const move = delta => {
                    const ids = enabled();
                    const i = ids.indexOf(id);
                    const j = i + delta;
                    if (i < 0 || j < 0 || j >= ids.length)
                        return;
                    [ids[i], ids[j]] = [ids[j], ids[i]];
                    saveEnabled(ids);
                };
                up.connect('clicked', () => move(-1));
                down.connect('clicked', () => move(1));

                const spin = new Gtk.SpinButton({
                    adjustment: new Gtk.Adjustment({lower: info.minCells, upper: 12, step_increment: 1, value: cells[id]}),
                    valign: Gtk.Align.CENTER,
                    sensitive: isOn,
                    tooltip_text: _('Width in cells'),
                });
                spin.connect('value-changed', () => {
                    const next = readCells();
                    next[id] = spin.get_value_as_int();
                    settings.set_value('widget-cells', new GLib.Variant('a{si}', next));
                });

                const toggle = new Gtk.Switch({
                    active: isOn,
                    valign: Gtk.Align.CENTER,
                    sensitive: !(isOn && on.length <= 1),
                });
                toggle.connect('notify::active', () => {
                    const ids = enabled();
                    if (toggle.active && !ids.includes(id))
                        ids.push(id);
                    else if (!toggle.active && ids.length > 1)
                        ids.splice(ids.indexOf(id), 1);
                    saveEnabled(ids);
                });

                for (const suffix of [up, down, spin, toggle])
                    row.add_suffix(suffix);
                list.add(row);
                rows.push(row);
            });
        };

        settings.connect('changed::enabled-widgets', () => {
            rebuildRows();
            rebuildPreview();
        });
        settings.connect('changed::widget-cells', rebuildPreview);
        rebuildRows();
        rebuildPreview();

        page.add(this._resetGroup(settings,
            ['enabled-widgets', 'widget-cells', 'width-mode', 'fixed-width', 'size-scale']));
        return page;
    }

    // --- Appearance ---------------------------------------------------------

    _appearancePage(settings) {
        const page = this._page(_('Appearance'), 'applications-graphics-symbolic', 'appearance');

        const shape = new Adw.PreferencesGroup({
            title: _('Shape'),
            description: _('Changes apply immediately.'),
        });
        shape.add(this._spin(settings, 'corner-radius', _('Corner radius'), _('In pixels'), [8, 44, 1]));
        shape.add(this._spin(settings, 'background-opacity', _('Transparency'),
            _('Background opacity: 1.00 is fully opaque'), [0.5, 1.0, 0.02], 2));
        shape.add(this._spin(settings, 'shadow-strength', _('Shadow'),
            _('0 turns the shadow off'), [0, 1, 0.1], 1));
        page.add(shape);

        const space = new Adw.PreferencesGroup({title: _('Size and spacing')});
        space.add(this._spin(settings, 'row-height', _('Height'),
            _('Height of the widget area, in pixels'), [90, 220, 2]));
        space.add(this._spin(settings, 'content-padding', _('Padding'),
            _('Space around the widgets'), [6, 32, 1]));
        space.add(this._spin(settings, 'widget-spacing', _('Spacing'),
            _('Space between widgets'), [0, 40, 1]));
        space.add(this._toggle(settings, 'show-dividers', _('Dividers'),
            _('Thin lines between widgets')));
        page.add(space);

        page.add(this._resetGroup(settings, ['corner-radius', 'background-opacity', 'shadow-strength',
            'row-height', 'content-padding', 'widget-spacing', 'show-dividers']));
        return page;
    }

    // --- Tray ---------------------------------------------------------------

    _trayPage(settings) {
        const page = this._page(_('Tray'), 'folder-download-symbolic', 'tray');
        const group = new Adw.PreferencesGroup({
            title: _('Tray'),
            description: _('Drag files over the capsule and release them to put them in the tray. ' +
                'The files themselves are never copied or moved.'),
        });
        group.add(this._toggle(settings, 'tray-keep-files', _('Keep files'),
            _('Remember the tray after a restart or logout')));
        page.add(group);
        page.add(this._resetGroup(settings, ['tray-keep-files']));
        return page;
    }

    // --- Live Activities ------------------------------------------------------

    _activitiesPage(settings) {
        const page = this._page(_('Live Activities'), 'media-playback-start-symbolic', 'activities');

        const collapsed = new Adw.PreferencesGroup({title: _('Collapsed capsule')});
        collapsed.add(this._toggle(settings, 'activities-in-collapsed', _('Show activities when collapsed'),
            _('A running timer, music or a meeting instead of the time')));
        page.add(collapsed);

        const kinds = new Adw.PreferencesGroup({
            title: _('Activities'),
            description: _('Choose what gets its own place in the capsule.'),
        });
        kinds.add(this._toggle(settings, 'activity-media', _('Music'),
            _('The track that is playing, and a card when it changes')));
        kinds.add(this._toggle(settings, 'activity-timer', _('Timer'),
            _('The countdown (the alarm card always shows)')));
        kinds.add(this._toggle(settings, 'activity-calendar', _('Calendar'),
            _('A meeting that starts in the next 10 minutes')));
        kinds.add(this._toggle(settings, 'activity-files', _('Tray'),
            _('A card when files are added to the tray')));
        page.add(kinds);

        page.add(this._resetGroup(settings, ['activities-in-collapsed', 'activity-media',
            'activity-timer', 'activity-calendar', 'activity-files']));
        return page;
    }
}
