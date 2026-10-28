import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {DEFAULT_WIDGETS, WIDGET_INFO} from './src/utils/widgetInfo.js';

// --- theme -----------------------------------------------------------------
// One place for every colour of the settings window (layered surfaces, a quiet blue accent, a dark
// "capsule" preview). Both schemes follow the system setting.
const SETTINGS_THEME = {
    light: {
        BACKGROUND: '#e9e9ec',
        TOOLBAR: '#efeff2',
        SURFACE: '#e1e2e6',
        CARD: '#f6f6f8',
        CONTROL: '#ffffff',
        BORDER: 'rgba(0, 0, 0, 0.10)',
        HOVER: 'rgba(0, 0, 0, 0.06)',
        SELECTED: 'rgba(0, 0, 0, 0.09)',
        TEXT: '#26272b',
        TEXT_SECONDARY: '#6d6f78',
        TEXT_DISABLED: '#a4a6ae',
        ACCENT: '#1a73f0',
        ACCENT_SOFT: 'rgba(26, 115, 240, 0.16)',
        CAPSULE: '#0c0c10',
        CAPSULE_BLOCK: '#232327',
        TRACK: 'rgba(0, 0, 0, 0.14)',
    },
    dark: {
        BACKGROUND: '#1c1d21',
        TOOLBAR: '#25262b',
        SURFACE: '#26272c',
        CARD: '#2f3036',
        CONTROL: '#3a3b42',
        BORDER: 'rgba(255, 255, 255, 0.09)',
        HOVER: 'rgba(255, 255, 255, 0.06)',
        SELECTED: 'rgba(255, 255, 255, 0.10)',
        TEXT: '#f1f1f4',
        TEXT_SECONDARY: '#9b9ca5',
        TEXT_DISABLED: '#686972',
        ACCENT: '#4c97ff',
        ACCENT_SOFT: 'rgba(76, 151, 255, 0.22)',
        CAPSULE: '#050507',
        CAPSULE_BLOCK: '#1d1d21',
        TRACK: 'rgba(255, 255, 255, 0.16)',
    },
};

const buildCss = p => `
window.background, window.background > contents { background-color: ${p.BACKGROUND}; }
headerbar { background-image: none; background-color: ${p.TOOLBAR}; box-shadow: none;
    border-bottom: none; color: ${p.TEXT}; }
headerbar label { color: ${p.TEXT}; font-weight: 600; }
preferencespage > scrolledwindow > viewport > clamp, preferencespage clamp { margin: 0; }
preferencespage { background-color: ${p.BACKGROUND}; }
.osmin-prefs { background-color: ${p.BACKGROUND}; color: ${p.TEXT}; }
.osmin-prefs label { color: ${p.TEXT}; }
.osmin-prefs .dim, .osmin-prefs label.dim { color: ${p.TEXT_SECONDARY}; font-size: 12px; }
.osmin-prefs separator { background-color: ${p.BORDER}; min-height: 1px; min-width: 1px; }

.osmin-toolbar { background-color: ${p.TOOLBAR}; border-bottom: 1px solid ${p.BORDER};
    padding: 8px 10px 8px 10px; }
.osmin-tab { background: none; box-shadow: none; border: none; border-radius: 9px;
    padding: 6px 6px 5px 6px; min-width: 56px; color: ${p.TEXT_SECONDARY};
    transition: background-color 120ms ease, color 120ms ease; }
.osmin-tab:hover { background-color: ${p.HOVER}; }
.osmin-tab:checked { background-color: ${p.SELECTED}; color: ${p.ACCENT}; }
.osmin-tab label, .osmin-tab image { color: inherit; }
.osmin-tab label { font-size: 12px; font-weight: 500; }

.osmin-seg { background-color: ${p.HOVER}; border-radius: 9px; padding: 2px; }
.osmin-seg button { background: none; box-shadow: none; border: none; border-radius: 7px;
    min-height: 24px; padding: 2px 14px; color: ${p.TEXT};
    transition: background-color 120ms ease; }
.osmin-seg button:hover { background-color: ${p.HOVER}; }
.osmin-seg button:checked { background-color: ${p.CONTROL}; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25); }

.osmin-panel { background-color: ${p.SURFACE}; border: 1px solid ${p.BORDER}; border-radius: 14px;
    padding: 14px; }
.osmin-page-title { font-size: 17px; font-weight: 700; }

.osmin-capsule { background-color: ${p.CAPSULE}; border-radius: 0 0 30px 30px; padding: 10px 12px 12px 12px;
    min-height: 74px; }
.osmin-capsule-block { background-color: ${p.CAPSULE_BLOCK}; border-radius: 12px; min-height: 56px; padding: 6px; }
.osmin-capsule-block label { color: white; font-weight: 700; font-size: 12px; }
.osmin-capsule-block image { color: white; }
.osmin-capsule-empty { color: rgba(255, 255, 255, 0.5); }

.osmin-strip { background-color: ${p.HOVER}; border-radius: 16px; padding: 6px; }
.osmin-chip { border-radius: 12px; padding: 7px 8px; transition: background-color 120ms ease; }
.osmin-chip:hover { background-color: ${p.HOVER}; }
.osmin-chip.selected { background-color: ${p.ACCENT_SOFT}; }
.osmin-chip.off .osmin-chip-title, .osmin-chip.off .osmin-chip-sub { color: ${p.TEXT_DISABLED}; }
.osmin-chip-title { font-weight: 700; font-size: 13px; }
.osmin-chip-sub { color: ${p.TEXT_SECONDARY}; font-size: 12px; }
.osmin-icon { background-image: linear-gradient(to bottom, #3d9bff, #1664e8); border-radius: 9px;
    color: white; min-width: 34px; min-height: 34px; }
.osmin-icon image { color: white; }
.osmin-chip.off .osmin-icon { opacity: 0.5; }

.osmin-prefs switch { min-height: 22px; background-color: ${p.TRACK}; border: none; border-radius: 12px;
    transition: background-color 150ms ease; }
.osmin-prefs switch:checked { background-color: ${p.ACCENT}; }
.osmin-prefs switch slider { background-color: white; border: none; border-radius: 10px; min-width: 18px;
    min-height: 18px; margin: 2px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35); }
.osmin-prefs checkbutton { color: ${p.TEXT}; }
.osmin-prefs checkbutton radio { background-color: ${p.CONTROL}; border: 1px solid ${p.BORDER}; min-width: 16px; min-height: 16px; }
.osmin-prefs checkbutton radio:checked { background-color: ${p.ACCENT}; border-color: ${p.ACCENT}; color: white; }
.osmin-prefs scale trough { background-color: ${p.TRACK}; min-height: 4px; border-radius: 2px; border: none; }
.osmin-prefs scale highlight { background-color: ${p.ACCENT}; border-radius: 2px; border: none; }
.osmin-prefs scale slider { background-color: white; border: none; min-width: 16px; min-height: 16px;
    border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4); }
.osmin-prefs scale slider:hover { box-shadow: 0 1px 4px rgba(0, 0, 0, 0.55); }
.osmin-value { background-color: ${p.CONTROL}; color: ${p.TEXT}; border: 1px solid ${p.BORDER};
    border-radius: 7px; min-height: 26px; box-shadow: none; }
.osmin-value text { color: ${p.TEXT}; }
.osmin-value button { background: none; box-shadow: none; border: none; color: ${p.TEXT_SECONDARY}; }
.osmin-btn { background-color: ${p.CONTROL}; color: ${p.TEXT}; border: 1px solid ${p.BORDER};
    border-radius: 8px; box-shadow: none; padding: 3px 14px; min-height: 26px;
    transition: background-color 120ms ease; }
.osmin-btn:hover { background-color: ${p.CARD}; }
.osmin-btn:active { background-color: ${p.SELECTED}; }
.osmin-btn:disabled { color: ${p.TEXT_DISABLED}; }
.osmin-btn.destructive { color: #e5484d; }
.osmin-prefs dropdown > button { background-color: ${p.CONTROL}; color: ${p.TEXT}; border: 1px solid ${p.BORDER};
    border-radius: 8px; box-shadow: none; min-height: 26px; }
`;

const WIDGET_ICONS = {
    media: 'folder-music-symbolic',
    calendar: 'x-office-calendar-symbolic',
    mirror: 'camera-web-symbolic',
    timer: 'alarm-symbolic',
    todo: 'checkbox-checked-symbolic',
    notes: 'document-edit-symbolic',
    shortcuts: 'view-app-grid-symbolic',
    tools: 'applications-utilities-symbolic',
    focus: 'preferences-system-time-symbolic',
};

const ALL_APPEARANCE_KEYS = ['panel-color', 'panel-opacity', 'corner-radius', 'background-opacity', 'shadow-strength',
    'row-height', 'content-padding', 'widget-spacing', 'show-dividers'];

export default class OsminPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(780, 780);
        window.title = _('Osmin');
        window.search_enabled = false;

        this._installTheme();

        const page = new Adw.PreferencesPage({title: _('Osmin'), icon_name: 'preferences-system-symbolic'});
        const group = new Adw.PreferencesGroup();
        const root = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['osmin-prefs']});
        group.add(root);
        page.add(group);
        window.add(page);

        const pages = [
            ['general', _('General'), 'preferences-system-symbolic', this._generalPage(settings)],
            ['osmin', _('Osmin'), 'view-grid-symbolic', this._osminPage(settings)],
            ['appearance', _('Appearance'), 'applications-graphics-symbolic', this._appearancePage(settings)],
            ['gestures', _('Gestures'), 'input-touchpad-symbolic', this._gesturesPage(settings)],
            ['tray', _('Tray'), 'folder-download-symbolic', this._trayPage(settings)],
            ['clipboard', _('Clipboard'), 'edit-paste-symbolic', this._clipboardPage(settings)],
            ['activities', _('Live Activities'), 'media-playback-start-symbolic', this._activitiesPage(settings)],
            ['about', _('About'), 'help-about-symbolic', this._aboutPage()],
        ];

        const stack = new Gtk.Stack({
            transition_type: Gtk.StackTransitionType.CROSSFADE,
            transition_duration: 140,
            vexpand: true,
            hhomogeneous: true,
            vhomogeneous: false,
        });
        const toolbar = new Gtk.Box({
            css_classes: ['osmin-toolbar'],
            spacing: 4,
            halign: Gtk.Align.FILL,
            homogeneous: false,
        });
        const inner = new Gtk.Box({halign: Gtk.Align.CENTER, spacing: 4});
        toolbar.append(inner);
        let first = null;
        for (const [name, title, icon, content] of pages) {
            stack.add_named(content, name);
            const tab = new Gtk.ToggleButton({css_classes: ['osmin-tab'], group: first});
            first ??= tab;
            const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 3});
            box.append(new Gtk.Image({icon_name: icon, pixel_size: 24}));
            box.append(new Gtk.Label({label: title}));
            tab.set_child(box);
            tab.connect('toggled', () => {
                if (tab.active)
                    stack.set_visible_child_name(name);
            });
            inner.append(tab);
        }
        first.active = true;
        toolbar.halign = Gtk.Align.FILL;
        inner.hexpand = true;

        root.append(toolbar);
        root.append(stack);
    }

    // --- theme --------------------------------------------------------------

    _installTheme() {
        const provider = new Gtk.CssProvider();
        const style = Adw.StyleManager.get_default();
        const apply = () => provider.load_from_string(buildCss(SETTINGS_THEME[style.dark ? 'dark' : 'light']));
        apply();
        style.connect('notify::dark', apply);
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1);
    }

    // --- building blocks ------------------------------------------------------

    /** A page body: a centred column that the form helpers fill. */
    _body() {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 18,
            margin_bottom: 22,
            margin_start: 22,
            margin_end: 22,
        });
        return box;
    }

    _form() {
        const grid = new Gtk.Grid({column_spacing: 18, row_spacing: 10, halign: Gtk.Align.FILL, hexpand: true});
        grid._row = 0;
        return grid;
    }

    _dim(text) {
        return new Gtk.Label({
            label: text,
            css_classes: ['dim'],
            wrap: true,
            xalign: 0,
            halign: Gtk.Align.START,
            max_width_chars: 52,
        });
    }

    /** One form row: right-aligned label, control on the left of the second column, optional note. */
    _row(grid, label, control, note = '') {
        const r = grid._row++;
        if (label) {
            grid.attach(new Gtk.Label({
                label,
                xalign: 1,
                halign: Gtk.Align.END,
                valign: Gtk.Align.CENTER,
                width_chars: 16,
            }), 0, r, 1, 1);
        }
        control.halign = control.halign === Gtk.Align.FILL ? Gtk.Align.FILL : Gtk.Align.START;
        control.valign = Gtk.Align.CENTER;
        grid.attach(control, 1, r, 1, 1);
        if (note) {
            const n = grid._row++;
            grid.attach(this._dim(note), 1, n, 1, 1);
        }
    }

    _rule(grid) {
        const r = grid._row++;
        const sep = new Gtk.Separator({margin_top: 6, margin_bottom: 6});
        grid.attach(sep, 0, r, 2, 1);
    }

    _switch(settings, key) {
        const sw = new Gtk.Switch({valign: Gtk.Align.CENTER});
        settings.bind(key, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
        return sw;
    }

    /** Slider with a boxed value, bound to a setting. */
    _slider(settings, key, [lower, upper, step], digits = 0, width = 230) {
        const adjustment = new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5});
        const box = new Gtk.Box({spacing: 10, halign: Gtk.Align.FILL, hexpand: true});
        const scale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment,
            draw_value: false,
            hexpand: true,
            width_request: width,
        });
        const spin = new Gtk.SpinButton({adjustment, digits, css_classes: ['osmin-value'], width_chars: 5});
        settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        box.append(scale);
        box.append(spin);
        return box;
    }

    _button(label, onClick, destructive = false) {
        const button = new Gtk.Button({label, css_classes: destructive ? ['osmin-btn', 'destructive'] : ['osmin-btn']});
        button.connect('clicked', onClick);
        return button;
    }

    _resetRow(grid, settings, keys, label = _('Reset these settings')) {
        this._rule(grid);
        this._row(grid, _('Others'), this._button(label, () => keys.forEach(k => settings.reset(k))));
    }

    _segmented(items, onSelect) {
        const box = new Gtk.Box({css_classes: ['osmin-seg'], spacing: 2, halign: Gtk.Align.CENTER});
        let first = null;
        items.forEach(([id, title], i) => {
            const b = new Gtk.ToggleButton({label: title, group: first});
            first ??= b;
            b.connect('toggled', () => {
                if (b.active)
                    onSelect(id);
            });
            box.append(b);
            if (i === 0)
                b.active = true;
        });
        return box;
    }

    _icon(name) {
        const box = new Gtk.Box({css_classes: ['osmin-icon'], halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER});
        box.append(new Gtk.Image({icon_name: name, pixel_size: 18, hexpand: true, vexpand: true}));
        return box;
    }

    /** A pill with one chip per entry: coloured icon, name, caption, switch. */
    _chip({icon, title, caption, active, selected, sensitive = true, onToggle, onSelect}) {
        const chip = new Gtk.Box({css_classes: ['osmin-chip'], spacing: 10, hexpand: true, halign: Gtk.Align.FILL});
        if (selected)
            chip.add_css_class('selected');
        if (!active)
            chip.add_css_class('off');
        chip.append(this._icon(icon));

        const text = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.CENTER, hexpand: true});
        text.append(new Gtk.Label({label: title, xalign: 0, css_classes: ['osmin-chip-title']}));
        if (caption)
            text.append(new Gtk.Label({label: caption, xalign: 0, css_classes: ['osmin-chip-sub']}));
        chip.append(text);

        const sw = new Gtk.Switch({active, valign: Gtk.Align.CENTER, sensitive});
        sw.connect('notify::active', () => onToggle(sw.active));
        chip.append(sw);

        if (onSelect) {
            const click = new Gtk.GestureClick();
            click.connect('released', () => onSelect());
            chip.add_controller(click);
        }
        return chip;
    }

    _strip() {
        const flow = new Gtk.FlowBox({
            css_classes: ['osmin-strip'],
            selection_mode: Gtk.SelectionMode.NONE,
            homogeneous: true,
            min_children_per_line: 1,
            max_children_per_line: 2,
            column_spacing: 4,
            row_spacing: 4,
            activate_on_single_click: false,
            valign: Gtk.Align.START,
            vexpand: false,
        });
        return flow;
    }

    // --- General ----------------------------------------------------------

    _generalPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);

        this._toggleRow(form, settings, 'open-on-hover', _('Osmin'), _('Open on hover'),
            _('Off: the capsule opens on click only.'));
        this._toggleRow(form, settings, 'auto-collapse', '', _('Collapse when the pointer leaves'),
            _('Off: it stays open until you close it.'));

        this._rule(form);
        this._row(form, _('Collapsed width'), this._slider(settings, 'collapsed-width-adjust', [-30, 80, 1]),
            _('Fine tune the width of the collapsed capsule, in pixels.'));
        this._row(form, _('Animation speed'), this._slider(settings, 'animation-speed', [0.5, 2.0, 0.1], 1),
            _('Higher is faster.'));

        this._rule(form);
        for (const [key, title] of [
            ['shortcut-osmin', _('Osmin')], ['shortcut-tray', _('Tray')],
            ['shortcut-clipboard', _('Clipboard')], ['shortcut-alerts', _('Alerts')],
        ]) {
            const line = new Gtk.Box({spacing: 10});
            line.append(new Gtk.Label({label: title, xalign: 0, width_chars: 10}));
            line.append(this._shortcutButton(settings, key));
            this._row(form, key === 'shortcut-osmin' ? _('Shortcuts') : '', line,
                key === 'shortcut-alerts' ? _('Open the panel on a section. Press the same keys again to close it. Backspace clears, Esc cancels.') : '');
        }

        this._toggleRow(form, settings, 'localsend-receive', _('LocalSend'), _('Receive files'),
            _('Makes this computer visible to LocalSend devices on your network (port 53317). Every transfer must be accepted in a card first; files are saved in Downloads. Close the LocalSend app first: only one can listen.'));
        this._toggleRow(form, settings, 'free-super-v', '', _('Free Super+V from GNOME'),
            _('GNOME opens its notification list on Super+V, so you cannot record it. This takes that binding away while Osmin is enabled and gives it back when Osmin is disabled. Turn it on first, then record Super+V.'));

        this._rule(form);
        this._row(form, _('Show on'), this._monitorsEditor(settings),
            _('The monitors that get a capsule. "Primary" follows the monitor GNOME calls primary; the top bar is only there.'));

        this._resetRow(form, settings, settings.settings_schema.list_keys(), _('Reset all settings'));
        return body;
    }

    /** A button that records a key combination into an `as` setting (empty = none). */
    _shortcutButton(settings, key) {
        const button = new Gtk.Button({halign: Gtk.Align.START, width_request: 160});
        let recording = false;
        const show = () => {
            const [accel] = settings.get_strv(key);
            button.label = recording ? _('Press keys…')
                : accel ? Gtk.accelerator_get_label(...Gtk.accelerator_parse(accel).slice(1)) : _('Not set');
        };
        const stop = () => {
            recording = false;
            show();
        };
        button.connect('clicked', () => {
            recording = true;
            show();
            button.grab_focus();
        });
        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_c, keyval, _keycode, state) => {
            if (!recording)
                return false;
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            if (keyval === Gdk.KEY_Escape && mods === 0) {
                stop();
                return true;
            }
            if (keyval === Gdk.KEY_BackSpace && mods === 0) {
                settings.set_strv(key, []);
                stop();
                return true;
            }
            // A bare modifier (or a key that cannot make a shortcut) keeps waiting.
            if (mods === 0 || !Gtk.accelerator_valid(keyval, mods))
                return true;
            settings.set_strv(key, [Gtk.accelerator_name(keyval, mods)]);
            stop();
            return true;
        });
        button.add_controller(keys);
        const focus = new Gtk.EventControllerFocus();
        focus.connect('leave', stop);
        button.add_controller(focus);
        const changedId = settings.connect(`changed::${key}`, show);
        button.connect('destroy', () => settings.disconnect(changedId));
        show();
        return button;
    }

    /** One switch per connected monitor (and one for "the primary one"); the choice is a list of connector names. */
    _monitorsEditor(settings) {
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
        const entries = [['primary', _('Primary monitor')]];
        const monitors = Gdk.Display.get_default()?.get_monitors();
        for (let i = 0; monitors && i < monitors.get_n_items(); i++) {
            const monitor = monitors.get_item(i);
            const connector = monitor.get_connector();
            if (!connector)
                continue;
            const geometry = monitor.get_geometry();
            const name = [monitor.get_manufacturer(), monitor.get_model()].filter(Boolean).join(' ');
            entries.push([connector, `${connector}${name ? ` · ${name}` : ''} · ${geometry.width}×${geometry.height}`]);
        }
        // Monitors that are chosen but not connected now stay in the list, so unplugging a screen forgets nothing.
        for (const id of settings.get_strv('monitors')) {
            if (!entries.some(([entry]) => entry === id))
                entries.push([id, `${id} · ${_('not connected')}`]);
        }

        const update = (id, on) => {
            const chosen = settings.get_strv('monitors').filter(entry => entry !== id);
            if (on)
                chosen.push(id);
            // Never leave the list empty: Osmin would have nowhere to be.
            settings.set_strv('monitors', chosen.length > 0 ? chosen : ['primary']);
        };
        const switches = new Map();
        const sync = () => {
            const chosen = settings.get_strv('monitors');
            for (const [id, toggle] of switches) {
                if (toggle.active !== chosen.includes(id))
                    toggle.active = chosen.includes(id);
            }
        };
        for (const [id, label] of entries) {
            const row = new Gtk.Box({spacing: 10});
            const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER, active: settings.get_strv('monitors').includes(id)});
            toggle.connect('notify::active', () => {
                if (toggle.active !== settings.get_strv('monitors').includes(id))
                    update(id, toggle.active);
            });
            switches.set(id, toggle);
            row.append(toggle);
            row.append(new Gtk.Label({label}));
            box.append(row);
        }
        const changedId = settings.connect('changed::monitors', sync);
        box.connect('destroy', () => settings.disconnect(changedId));
        return box;
    }

    /** "[switch] Title" with an optional note below, like the checkbox rows of the reference. */
    _toggleRow(grid, settings, key, label, title, note = '') {
        const box = new Gtk.Box({spacing: 10});
        box.append(this._switch(settings, key));
        box.append(new Gtk.Label({label: title}));
        this._row(grid, label, box, note);
    }

    /** "Detected" apps on the left, the ones "In use" on the right. */
    _shortcutsEditor(settings) {
        const editor = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8, margin_top: 10});
        const head = new Gtk.Box({spacing: 10});
        head.append(new Gtk.Label({label: _('Shortcuts'), css_classes: ['osmin-page-title']}));
        head.append(new Gtk.Separator({hexpand: true, valign: Gtk.Align.CENTER}));
        editor.append(head);

        const columns = new Gtk.Box({spacing: 10, homogeneous: true});
        editor.append(columns);

        const makeList = title => {
            const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
            box.append(new Gtk.Label({label: title, xalign: 0, css_classes: ['osmin-chip-title']}));
            const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, css_classes: ['osmin-panel']});
            const scroll = new Gtk.ScrolledWindow({
                child: list,
                min_content_height: 240,
                max_content_height: 240,
                hscrollbar_policy: Gtk.PolicyType.NEVER,
                vexpand: false,
            });
            box.append(scroll);
            columns.append(box);
            return list;
        };
        const detected = makeList(_('Detected'));
        const inUse = makeList(_('In use'));

        const clear = box => {
            let child;
            while ((child = box.get_first_child()))
                box.remove(child);
        };
        const appRow = (app, buttons) => {
            const row = new Gtk.Box({spacing: 8, margin_top: 2, margin_bottom: 2});
            row.append(new Gtk.Image({gicon: app.get_icon() ?? Gio.ThemedIcon.new('application-x-executable'),
                pixel_size: 22}));
            row.append(new Gtk.Label({label: app.get_name(), xalign: 0, hexpand: true,
                ellipsize: 3, max_width_chars: 16}));
            for (const b of buttons)
                row.append(b);
            return row;
        };

        const rebuild = () => {
            const used = settings.get_strv('shortcut-apps');
            clear(detected);
            clear(inUse);

            const all = Gio.AppInfo.get_all()
                .filter(app => app.should_show() && app.get_id() && !used.includes(app.get_id()))
                .sort((a, b) => a.get_name().localeCompare(b.get_name()));
            for (const app of all) {
                detected.append(appRow(app, [this._button(_('Use'), () => {
                    settings.set_strv('shortcut-apps', [...settings.get_strv('shortcut-apps'), app.get_id()]);
                })]));
            }

            const apps = used.map(id => Gio.DesktopAppInfo.new(id)).filter(Boolean);
            if (apps.length === 0) {
                inUse.append(new Gtk.Label({label: _('Select some shortcuts'), css_classes: ['dim'],
                    vexpand: true, valign: Gtk.Align.CENTER, margin_top: 90}));
            }
            apps.forEach((app, i) => {
                const move = (delta) => {
                    const ids = settings.get_strv('shortcut-apps');
                    const j = i + delta;
                    if (j < 0 || j >= ids.length)
                        return;
                    [ids[i], ids[j]] = [ids[j], ids[i]];
                    settings.set_strv('shortcut-apps', ids);
                };
                const up = new Gtk.Button({icon_name: 'go-up-symbolic', css_classes: ['flat'], sensitive: i > 0});
                const down = new Gtk.Button({icon_name: 'go-down-symbolic', css_classes: ['flat'],
                    sensitive: i < apps.length - 1});
                const remove = new Gtk.Button({icon_name: 'window-close-symbolic', css_classes: ['flat']});
                up.connect('clicked', () => move(-1));
                down.connect('clicked', () => move(1));
                remove.connect('clicked', () => {
                    settings.set_strv('shortcut-apps', settings.get_strv('shortcut-apps').filter(id => id !== app.get_id()));
                });
                inUse.append(appRow(app, [up, down, remove]));
            });
        };
        const id = settings.connect('changed::shortcut-apps', rebuild);
        editor.connect('destroy', () => settings.disconnect(id));
        rebuild();
        return editor;
    }

    // --- Osmin (widgets) -----------------------------------------------------

    _osminPage(settings) {
        const body = this._body();
        const sub = this._segmented([
            ['widgets', _('Customize widgets')],
            ['width', _('Capsule width')],
        ], id => substack.set_visible_child_name(id));
        body.append(sub);

        const substack = new Gtk.Stack({vexpand: true});
        body.append(substack);
        substack.add_named(this._widgetsView(settings), 'widgets');
        substack.add_named(this._widthView(settings), 'width');
        return body;
    }

    _widthView(settings) {
        const form = this._form();
        const modes = ['auto', 'fixed'];
        const mode = new Gtk.DropDown({model: Gtk.StringList.new([_('Auto'), _('Fixed')])});
        mode.selected = Math.max(0, modes.indexOf(settings.get_string('width-mode')));
        mode.connect('notify::selected', () => settings.set_string('width-mode', modes[mode.selected]));
        settings.connect('changed::width-mode', () => {
            mode.selected = Math.max(0, modes.indexOf(settings.get_string('width-mode')));
        });
        this._row(form, _('Width mode'), mode, _('Auto follows the widgets; fixed is a share of the screen.'));

        const fixed = this._slider(settings, 'fixed-width', [0.25, 0.9, 0.05], 2);
        const syncFixed = () => {
            fixed.sensitive = settings.get_string('width-mode') === 'fixed';
        };
        settings.connect('changed::width-mode', syncFixed);
        syncFixed();
        this._row(form, _('Fixed width'), fixed, _('Share of the screen width (fixed mode).'));

        this._rule(form);
        this._row(form, _('Widget size'), this._slider(settings, 'size-scale', [0.85, 1.25, 0.05], 2),
            _('Scales the width of every cell.'));
        this._resetRow(form, settings, ['width-mode', 'fixed-width', 'size-scale']);
        return form;
    }

    _widgetsView(settings) {
        const view = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 14});

        // Preview: the capsule with one block per enabled widget.
        const capsule = new Gtk.Box({
            css_classes: ['osmin-capsule'],
            spacing: 8,
            halign: Gtk.Align.CENTER,
            homogeneous: false,
        });
        const previewHolder = new Gtk.Box({css_classes: ['osmin-panel'], halign: Gtk.Align.FILL, hexpand: true});
        capsule.hexpand = false;
        previewHolder.append(capsule);
        capsule.halign = Gtk.Align.CENTER;
        capsule.hexpand = true;
        view.append(previewHolder);

        const strip = this._strip();
        view.append(strip);

        const options = this._form();
        view.append(options);

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
        let selected = enabled()[0];

        const clear = box => {
            let child;
            while ((child = box.get_first_child()))
                box.remove(child);
        };

        const rebuildPreview = () => {
            clear(capsule);
            const cells = readCells();
            for (const id of enabled()) {
                const info = WIDGET_INFO.find(w => w.id === id);
                const block = new Gtk.Box({
                    css_classes: ['osmin-capsule-block'],
                    orientation: Gtk.Orientation.VERTICAL,
                    valign: Gtk.Align.CENTER,
                    spacing: 4,
                });
                block.set_size_request(cells[id] * 22, -1);
                block.append(new Gtk.Image({icon_name: WIDGET_ICONS[id], pixel_size: 16, vexpand: true,
                    valign: Gtk.Align.END}));
                block.append(new Gtk.Label({label: _(info.title), wrap: true, vexpand: true,
                    valign: Gtk.Align.START, justify: Gtk.Justification.CENTER}));
                capsule.append(block);
            }
        };

        const rebuildOptions = () => {
            clear(options);
            options._row = 0;
            const info = WIDGET_INFO.find(w => w.id === selected);
            const on = enabled();
            const isOn = on.includes(selected);
            const cells = readCells();

            const spin = new Gtk.Adjustment({
                lower: info.minCells, upper: 12, step_increment: 1, page_increment: 1, value: cells[selected],
            });
            const box = new Gtk.Box({spacing: 10, hexpand: true, halign: Gtk.Align.FILL});
            const scale = new Gtk.Scale({
                adjustment: spin, draw_value: false, hexpand: true, width_request: 230,
                sensitive: isOn, digits: 0,
            });
            scale.set_round_digits(0);
            const value = new Gtk.SpinButton({adjustment: spin, css_classes: ['osmin-value'], width_chars: 3,
                sensitive: isOn});
            spin.connect('value-changed', () => {
                const next = readCells();
                const v = Math.round(spin.get_value());
                if (next[selected] === v)
                    return;
                next[selected] = v;
                settings.set_value('widget-cells', new GLib.Variant('a{si}', next));
            });
            box.append(scale);
            box.append(value);
            this._row(options, _('Width'), box, _('Width of %s, in cells.').format(_(info.title)));

            const moves = new Gtk.Box({spacing: 6});
            const index = on.indexOf(selected);
            const left = this._button(_('Move left'), () => move(-1));
            const right = this._button(_('Move right'), () => move(1));
            left.sensitive = isOn && index > 0;
            right.sensitive = isOn && index < on.length - 1;
            moves.append(left);
            moves.append(right);
            this._row(options, _('Position'), moves, _('The order of the widgets in the capsule.'));

            if (selected === 'shortcuts') {
                const cols = new Gtk.Box({spacing: 18});
                let firstRadio = null;
                for (const [n, title] of [[1, _('1 Column')], [2, _('2 Columns')]]) {
                    const radio = new Gtk.CheckButton({label: title, group: firstRadio});
                    firstRadio ??= radio;
                    radio.active = settings.get_int('shortcut-columns') === n;
                    radio.connect('toggled', () => {
                        if (radio.active)
                            settings.set_int('shortcut-columns', n);
                    });
                    cols.append(radio);
                }
                this._row(options, _('Columns'), cols, _('Each column contains 2 rows (2 shortcuts).'));
                const r = options._row++;
                options.attach(this._shortcutsEditor(settings), 0, r, 2, 1);
            }

            this._resetRow(options, settings, ['enabled-widgets', 'widget-cells', 'shortcut-apps',
                'shortcut-columns']);
        };

        const move = delta => {
            const ids = enabled();
            const i = ids.indexOf(selected);
            const j = i + delta;
            if (i < 0 || j < 0 || j >= ids.length)
                return;
            [ids[i], ids[j]] = [ids[j], ids[i]];
            saveEnabled(ids);
        };

        const rebuildStrip = () => {
            clear(strip);
            const on = enabled();
            const ordered = [...on, ...WIDGET_INFO.map(w => w.id).filter(id => !on.includes(id))];
            const cells = readCells();
            for (const id of ordered) {
                const info = WIDGET_INFO.find(w => w.id === id);
                const isOn = on.includes(id);
                strip.append(this._chip({
                    icon: WIDGET_ICONS[id],
                    title: _(info.title),
                    caption: isOn ? _('%d cells').format(cells[id]) : _('Off'),
                    active: isOn,
                    selected: id === selected,
                    sensitive: !(isOn && on.length <= 1),
                    onToggle: active => {
                        const ids = enabled();
                        if (active && !ids.includes(id))
                            ids.push(id);
                        else if (!active && ids.length > 1)
                            ids.splice(ids.indexOf(id), 1);
                        else
                            return;
                        selected = id;
                        saveEnabled(ids);
                    },
                    onSelect: () => {
                        selected = id;
                        refresh();
                    },
                }));
            }
        };

        const refresh = () => {
            rebuildStrip();
            rebuildPreview();
            rebuildOptions();
        };
        settings.connect('changed::enabled-widgets', refresh);
        // Cells change while the slider is dragged: only refresh the pieces that show them.
        settings.connect('changed::widget-cells', () => {
            rebuildStrip();
            rebuildPreview();
        });
        refresh();
        return view;
    }

    // --- Appearance ---------------------------------------------------------

    _appearancePage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);

        this._row(form, _('Corner radius'), this._slider(settings, 'corner-radius', [8, 44, 1]),
            _('In pixels.'));
        this._row(form, _('Transparency'), this._slider(settings, 'background-opacity', [0.5, 1.0, 0.02], 2),
            _('Background opacity: 1.00 is fully opaque.'));
        this._row(form, _('Shadow'), this._slider(settings, 'shadow-strength', [0, 1, 0.1], 1),
            _('0 turns the shadow off.'));

        this._rule(form);
        const picker = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({with_alpha: false})});
        const parse = hex => {
            const rgba = new Gdk.RGBA();
            return rgba.parse(hex) ? rgba : null;
        };
        const toHex = rgba => '#' + [rgba.red, rgba.green, rgba.blue]
            .map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
        picker.rgba = parse(settings.get_string('panel-color')) ?? parse('#000000');
        picker.connect('notify::rgba', () => {
            const hex = toHex(picker.rgba);
            if (hex !== settings.get_string('panel-color'))
                settings.set_string('panel-color', hex);
        });
        settings.connect('changed::panel-color', () => {
            const rgba = parse(settings.get_string('panel-color'));
            if (rgba && toHex(rgba) !== toHex(picker.rgba))
                picker.rgba = rgba;
        });
        this._row(form, _('Top bar color'), picker, _('The color of the GNOME top bar while Osmin is on.'));
        this._row(form, _('Top bar opacity'), this._slider(settings, 'panel-opacity', [0, 1, 0.05], 2),
            _('0 is fully transparent, 1 is solid.'));

        this._rule(form);
        this._row(form, _('Height'), this._slider(settings, 'row-height', [90, 220, 2]),
            _('Height of the widget area, in pixels.'));
        this._row(form, _('Padding'), this._slider(settings, 'content-padding', [6, 32, 1]),
            _('Space around the widgets.'));
        this._row(form, _('Spacing'), this._slider(settings, 'widget-spacing', [0, 40, 1]),
            _('Space between widgets.'));

        this._rule(form);
        this._toggleRow(form, settings, 'show-dividers', _('Widgets'), _('Dividers'),
            _('Thin lines between widgets.'));

        this._resetRow(form, settings, ALL_APPEARANCE_KEYS);
        return body;
    }

    // --- About --------------------------------------------------------------

    _aboutPage() {
        const body = this._body();
        body.halign = Gtk.Align.CENTER;
        body.valign = Gtk.Align.START;
        body.margin_top = 60;
        body.spacing = 8;
        const logo = this._icon('view-grid-symbolic');
        logo.set_size_request(72, 72);
        logo.halign = Gtk.Align.CENTER;
        logo.valign = Gtk.Align.START;
        logo.vexpand = false;
        body.append(logo);
        body.append(new Gtk.Label({label: _('Osmin'), css_classes: ['osmin-page-title']}));
        const version = this._dim(_('Version %s').format(this.metadata['version-name'] ?? ''));
        version.halign = Gtk.Align.CENTER;
        body.append(version);
        body.append(new Gtk.Label({
            label: _('A Dynamic Island for GNOME: media, calendar, mirror, shortcuts and a file tray in one capsule at the top of the screen.'),
            wrap: true,
            max_width_chars: 44,
            justify: Gtk.Justification.CENTER,
            margin_top: 8,
        }));
        const link = new Gtk.LinkButton({uri: this.metadata.url ?? '', label: _('Project page')});
        link.halign = Gtk.Align.CENTER;
        body.append(link);
        return body;
    }

    // --- Gestures -----------------------------------------------------------

    _gesturesPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);

        this._toggleRow(form, settings, 'gestures-swipe-open', _('Capsule'), _('Swipe down to open'),
            _('Two-finger swipe down over the collapsed capsule.'));
        this._toggleRow(form, settings, 'gestures-swipe-close', '', _('Swipe up to close'),
            _('Two-finger swipe up over the open capsule (on its first page).'));
        this._toggleRow(form, settings, 'gestures-invert', '', _('Invert direction'),
            _('Reverses every swipe: up opens, down closes, and so on.'));

        this._rule(form);
        this._toggleRow(form, settings, 'gestures-media-swipe', _('Media'), _('Swipe sideways to skip tracks'),
            _('While music is playing: left is the previous track, right the next one.'));

        const values = ['activity', 'play-pause', 'off'];
        const middle = new Gtk.DropDown({
            model: Gtk.StringList.new([_('Next activity'), _('Play / pause'), _('Nothing')]),
        });
        middle.selected = Math.max(0, values.indexOf(settings.get_string('gestures-middle-click')));
        middle.connect('notify::selected', () =>
            settings.set_string('gestures-middle-click', values[middle.selected]));
        settings.connect('changed::gestures-middle-click', () => {
            middle.selected = Math.max(0, values.indexOf(settings.get_string('gestures-middle-click')));
        });
        this._rule(form);
        this._row(form, _('Middle click'), middle, _('On the collapsed capsule.'));

        this._resetRow(form, settings, ['gestures-swipe-open', 'gestures-swipe-close', 'gestures-media-swipe',
            'gestures-invert', 'gestures-middle-click']);
        return body;
    }

    // --- Tray ---------------------------------------------------------------

    _trayPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);

        this._toggleRow(form, settings, 'tray-keep-files', _('Tray'), _('Keep files'),
            _('Remember the tray after a restart or logout.'));
        this._row(form, '', new Gtk.Box(),
            _('Drag files over the capsule and release them to put them in the tray. ' +
                'The files themselves are never copied or moved.'));

        this._resetRow(form, settings, ['tray-keep-files']);
        return body;
    }

    // --- Clipboard ----------------------------------------------------------

    _clipboardPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);

        this._toggleRow(form, settings, 'clipboard-click-pastes', _('Clipboard'), _('A click pastes'),
            _('Clicking an item puts it in the app you were using (Ctrl+V). Off: it is only copied.'));
        this._rule(form);
        this._toggleRow(form, settings, 'clipboard-keep-history', _('History'), _('Keep history after a restart'),
            _('Off: only pinned items and your notes are saved on disk, so copied passwords are not.'));
        this._row(form, _('History size'), this._slider(settings, 'clipboard-max-items', [5, 100, 5]),
            _('How many unpinned items are kept.'));
        this._row(form, '', new Gtk.Box(),
            _('Only text is recorded. Items copied from password managers are skipped.'));

        this._resetRow(form, settings, ['clipboard-click-pastes', 'clipboard-keep-history', 'clipboard-max-items']);
        return body;
    }

    // --- Live Activities ------------------------------------------------------

    _activitiesPage(settings) {
        const body = this._body();

        const strip = this._strip();
        const defs = [
            ['activity-media', _('Music'), _('Playing track'), 'folder-music-symbolic'],
            ['activity-timer', _('Timer'), _('Countdown'), 'alarm-symbolic'],
            ['activity-calendar', _('Calendar'), _('Next meeting'), 'x-office-calendar-symbolic'],
            ['activity-files', _('Tray'), _('Added files'), 'folder-download-symbolic'],
        ];
        const rebuild = () => {
            let child;
            while ((child = strip.get_first_child()))
                strip.remove(child);
            for (const [key, title, caption, icon] of defs) {
                const active = settings.get_boolean(key);
                strip.append(this._chip({
                    icon, title, caption, active, selected: false,
                    onToggle: value => {
                        if (value !== settings.get_boolean(key))
                            settings.set_boolean(key, value);
                    },
                }));
            }
        };
        defs.forEach(([key]) => settings.connect(`changed::${key}`, rebuild));
        rebuild();
        body.append(strip);
        body.append(this._dim(_('Choose what gets its own place in the capsule.')));

        const form = this._form();
        body.append(form);
        this._toggleRow(form, settings, 'activities-in-collapsed', _('Collapsed capsule'),
            _('Show activities when collapsed'),
            _('A running timer, music or a meeting instead of the time.'));

        this._rule(form);
        this._row(form, _('Music card'), this._slider(settings, 'peek-media-seconds', [0.5, 10, 0.1], 1),
            _('Seconds the card with the new track stays on screen.'));
        this._row(form, _('Tray card'), this._slider(settings, 'peek-files-seconds', [0.5, 10, 0.1], 1),
            _('Seconds the "Adding / Added files" card stays on screen.'));
        this._row(form, _('Meeting card'), this._slider(settings, 'peek-calendar-seconds', [0.5, 30, 0.5], 1),
            _('Seconds the card about an upcoming meeting stays on screen.'));

        this._rule(form);
        this._row(form, _('Album corner radius'), this._slider(settings, 'album-corner-radius', [0, 24, 1]));

        const effects = [['bars', _('Audio spectrum')], ['waves', _('Waves')]];
        const radios = new Gtk.Box({spacing: 18});
        let first = null;
        for (const [value, title] of effects) {
            const radio = new Gtk.CheckButton({label: title, group: first});
            first ??= radio;
            radio.active = settings.get_string('media-effect') === value;
            radio.connect('toggled', () => {
                if (radio.active)
                    settings.set_string('media-effect', value);
            });
            settings.connect('changed::media-effect', () => {
                radio.active = settings.get_string('media-effect') === value;
            });
            radios.append(radio);
        }
        this._row(form, _('Effect type'), radios, _('The animation shown while music plays.'));
        this._toggleRow(form, settings, 'colored-effects', '', _('Colored effects'),
            _('The effect takes the color of the album art; otherwise it is white.'));

        this._resetRow(form, settings, ['activities-in-collapsed', 'album-corner-radius', 'media-effect',
            'colored-effects', 'activity-media',
            'activity-timer', 'activity-calendar', 'activity-files',
            'peek-media-seconds', 'peek-files-seconds', 'peek-calendar-seconds']);
        return body;
    }
}
