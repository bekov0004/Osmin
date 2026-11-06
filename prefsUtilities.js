import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * The settings pages of the tools (Command Bar, Quick toggles, Cleaning Mode, Screenshot, Color
 * picker and the sound pages), laid out like the reference: a title above a card, the first row of
 * a card a pill button that does the thing right now, grey hint lines between the rows.
 * Mixed into OsminPreferences, so `this` has its building blocks (_row, _form, _switch ...).
 */

const KEYS = {
    ctrl: '⌃', alt: '⌥', shift: '⇧', super: '⌘',
};

/** A name of an accelerator split into key caps: "<Control><Super>v" -> ['⌃', '⌘', 'V']. */
function capsOf(accel) {
    if (!accel)
        return [];
    const [ok, key, mods] = Gtk.accelerator_parse(accel);
    if (!ok)
        return [];
    const caps = [];
    if (mods & Gdk.ModifierType.CONTROL_MASK)
        caps.push(KEYS.ctrl);
    if (mods & Gdk.ModifierType.ALT_MASK)
        caps.push(KEYS.alt);
    if (mods & Gdk.ModifierType.SHIFT_MASK)
        caps.push(KEYS.shift);
    if (mods & Gdk.ModifierType.SUPER_MASK)
        caps.push(KEYS.super);
    const name = Gdk.keyval_name(key) ?? '';
    caps.push(name.length === 1 ? name.toUpperCase() : name.charAt(0).toUpperCase() + name.slice(1));
    return caps;
}

export const utilityMethods = {
    /** The blue "Try it" button of the page header and the pill buttons share this request. */
    _request(settings, name) {
        settings.set_string('action-request', `${name}:${GLib.get_monotonic_time()}`);
    },

    /** A card title above a card. */
    _title(form, text) {
        this._rule(form);
        form.append(new Gtk.Label({label: text, css_classes: ['s-card-title', 'mb-title'], xalign: 0, margin_start: 4}));
    },

    /** The first row of a card: a rounded button with an icon that runs an action. */
    _pill(form, icon, text, callback) {
        const content = new Gtk.Box({spacing: 8});
        if (icon)
            content.append(new Gtk.Image({icon_name: icon, pixel_size: 16}));
        content.append(new Gtk.Label({label: text}));
        const button = new Gtk.Button({child: content, css_classes: ['osmin-pill'], halign: Gtk.Align.START});
        button.connect('clicked', callback);
        const wrap = new Gtk.Box({hexpand: true});
        wrap.append(button);
        this._row(form, '', wrap);
        return button;
    },

    /** A line of grey text between two rows. */
    _hint(form, text) {
        const label = this._dim(text);
        label.hexpand = true;
        label.max_width_chars = 70;
        this._row(form, '', label);
        return label;
    },

    /** Switch row that turns a shortcut on (its default keys) or off (none), and the shortcut below it. */
    _shortcutPair(form, settings, key, fallback, title = _('Global shortcut')) {
        const sw = new Gtk.Switch({valign: Gtk.Align.CENTER});
        const caps = new Gtk.Box({spacing: 4, valign: Gtk.Align.CENTER});
        const button = new Gtk.Button({css_classes: ['osmin-caps'], child: caps});
        const reset = this._button(_('Reset'), () => settings.set_strv(key, [fallback]));
        let recording = false;
        const show = () => {
            const [accel] = settings.get_strv(key);
            sw.set_active(!!accel);
            let child = caps.get_first_child();
            while (child) {
                caps.remove(child);
                child = caps.get_first_child();
            }
            if (recording) {
                caps.append(new Gtk.Label({label: _('Press keys…')}));
            } else {
                for (const cap of capsOf(accel || fallback))
                    caps.append(new Gtk.Label({label: cap, css_classes: ['osmin-cap']}));
            }
            button.sensitive = !!accel;
            reset.sensitive = !!accel && accel !== fallback;
        };
        sw.connect('state-set', (_sw, state) => {
            const [accel] = settings.get_strv(key);
            if (state && !accel)
                settings.set_strv(key, [fallback]);
            else if (!state && accel)
                settings.set_strv(key, []);
            return false;
        });
        button.connect('clicked', () => {
            recording = true;
            show();
            button.grab_focus();
        });
        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_c, keyval, _code, state) => {
            if (!recording)
                return false;
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            if (keyval === Gdk.KEY_Escape && mods === 0) {
                recording = false;
                show();
                return true;
            }
            if ([Gdk.KEY_Control_L, Gdk.KEY_Control_R, Gdk.KEY_Shift_L, Gdk.KEY_Shift_R, Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
                Gdk.KEY_Super_L, Gdk.KEY_Super_R, Gdk.KEY_Meta_L, Gdk.KEY_Meta_R].includes(keyval))
                return true;
            if (mods === 0)
                return true;
            recording = false;
            settings.set_strv(key, [Gtk.accelerator_name(keyval, mods)]);
            return true;
        });
        button.add_controller(keys);
        settings.connect(`changed::${key}`, show);
        show();
        this._row(form, title, sw);
        const box = new Gtk.Box({spacing: 8});
        box._inline = true;
        box.append(button);
        box.append(reset);
        this._row(form, _('Shortcut'), box);
    },

    /** A drop-down bound to a string setting. */
    _dropdown(settings, key, items) {
        const model = new Gtk.StringList();
        items.forEach(([, title]) => model.append(title));
        const drop = new Gtk.DropDown({model, css_classes: ['osmin-drop']});
        const sync = () => {
            const index = items.findIndex(([value]) => String(value) === String(settings.get_value(key).deepUnpack()));
            drop.selected = Math.max(0, index);
        };
        drop.connect('notify::selected', () => {
            const [value] = items[drop.selected] ?? [];
            if (value === undefined)
                return;
            if (settings.get_value(key).get_type_string() === 'i')
                settings.set_int(key, Number(value));
            else
                settings.set_string(key, String(value));
        });
        sync();
        return drop;
    },

    // --- the pages ----------------------------------------------------------------

    _commandPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);
        this._title(form, _('Command Bar'));
        this._pill(form, 'system-search-symbolic', _('Open the search now'), () => this._request(settings, 'command'));
        this._hint(form, _('One shortcut opens a field over whatever you are doing. Type a few letters, press Return and it happens. Nothing you type is saved.'));
        this._hint(form, _('Search runs on this computer, with no account or cloud. It finds apps, files, settings, clipboard history, calculations and unit conversions.'));
        const tries = new Gtk.Box({spacing: 6, halign: Gtk.Align.START});
        tries.append(new Gtk.Label({label: _('Try'), css_classes: ['dim']}));
        for (const text of ['100 km to mi', '2+2*3', 'fire', 'battery'])
            tries.append(new Gtk.Label({label: text, css_classes: ['osmin-tag']}));
        const triesWrap = new Gtk.Box({hexpand: true});
        triesWrap.append(tries);
        this._row(form, '', triesWrap);
        this._shortcutPair(form, settings, 'shortcut-command', '<Alt>space');

        this._title(form, _('Other shortcuts'));
        this._shortcutPair(form, settings, 'shortcut-clipboard', '<Control><Super>v', _('Clipboard history'));
        this._shortcutPair(form, settings, 'shortcut-tray', '<Control><Super>t', _('File shelf'));
        this._shortcutPair(form, settings, 'shortcut-osmin', '<Control><Super>o', _('Open the capsule'));
        this._hint(form, _('Each opens the capsule on its own tab, from anywhere.'));
        return body;
    },

    _togglesPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);
        this._title(form, _('Quick toggles'));
        this._pill(form, 'weather-clear-night-symbolic', _('Switch dark mode'), () => this._request(settings, 'dark'));
        this._pill(form, 'night-light-symbolic', _('Night light'), () => this._request(settings, 'night'));
        this._hint(form, _('One-click system actions in the top-bar window.'));

        this._title(form, _('Excluded drives'));
        const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4});
        const draw = () => {
            let child = list.get_first_child();
            while (child) {
                list.remove(child);
                child = list.get_first_child();
            }
            const excluded = settings.get_strv('eject-excluded');
            for (const path of excluded) {
                const row = new Gtk.Box({spacing: 8});
                row.append(new Gtk.Label({label: path, hexpand: true, xalign: 0, ellipsize: 3}));
                row.append(this._button(_('Remove'), () => {
                    settings.set_strv('eject-excluded', settings.get_strv('eject-excluded').filter(p => p !== path));
                }));
                list.append(row);
            }
            const mounts = Gio.VolumeMonitor.get().get_mounts()
                .map(m => m.get_root()?.get_path())
                .filter(p => p && (p.startsWith('/media/') || p.startsWith('/run/media/')) && !excluded.includes(p));
            for (const path of mounts) {
                list.append(this._button(`+ ${path}`, () => {
                    settings.set_strv('eject-excluded', [...settings.get_strv('eject-excluded'), path]);
                }));
            }
            if (!excluded.length && !mounts.length)
                list.append(this._dim(_('No drives are connected.')));
        };
        settings.connect('changed::eject-excluded', draw);
        draw();
        this._row(form, '', list);
        this._hint(form, _('Drives in this list are never unmounted when using Eject all disks.'));
        return body;
    },

    _cleaningPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);
        this._title(form, _('Cleaning Mode'));
        this._pill(form, 'input-keyboard-symbolic', _('Lock keyboard now'), () => this._request(settings, 'cleaning'));
        this._hint(form, _('Locks the keyboard and the pointer so you can clean safely. Hold Esc for 3 seconds to finish; it ends by itself after a minute.'));
        this._row(form, _('Keep screen visible'), this._switch(settings, 'cleaning-visible'));
        this._hint(form, _('Shows a discreet indicator in the corner of the screen instead of blacking out the content.'));
        this._shortcutPair(form, settings, 'shortcut-cleaning', '<Control><Alt><Super>l');
        return body;
    },

    /** Screenshot, recording and colour picker share a page group, as in the reference. */
    _screenshotPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);
        this._title(form, _('Screenshot'));
        this._pill(form, 'applets-screenshooter-symbolic', _('Take a screenshot'), () => this._request(settings, 'screenshot'));
        this._hint(form, _('Opens the screenshot tool of GNOME: pick an area, a window or the whole screen. The picture goes to the Pictures/Screenshots folder and the clipboard.'));
        this._shortcutPair(form, settings, 'shortcut-screenshot', '<Control><Alt><Super>s');

        this._title(form, _('Screen recording'));
        this._pill(form, 'media-record-symbolic', _('Record the screen'), () => this._request(settings, 'recording'));
        this._hint(form, _('Opens the same tool in recording mode. Press the button in the top bar to stop.'));
        this._shortcutPair(form, settings, 'shortcut-recording', '<Control><Alt><Super>r');
        return body;
    },

    _colorPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);
        this._title(form, _('Color picker'));
        this._pill(form, 'color-select-symbolic', _('Pick a color'), () => this._request(settings, 'color'));
        this._hint(form, _('Pick any pixel of the screen. The color is copied as a hex code, and shown as RGB and HSL.'));
        this._shortcutPair(form, settings, 'shortcut-color', '<Control><Alt><Super>c');
        return body;
    },

    _micPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);
        this._title(form, _('Mute microphone'));
        this._pill(form, 'microphone-sensitivity-muted-symbolic', _('Mute microphone'), () => this._request(settings, 'mic'));
        this._hint(form, _('Cuts the microphone with a click or a shortcut, across every app.'));
        this._shortcutPair(form, settings, 'shortcut-mic', '<Control><Alt><Super>m');
        return body;
    },

    _soundPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);
        this._title(form, _('Volume mixer'));
        this._pill(form, 'audio-volume-high-symbolic', _('Open the volume mixer'), () => this._request(settings, 'page-sound'));
        this._hint(form, _('The volume of every app on its own, the output device of each, and the microphone.'));
        this._hint(form, _('Turn the mixer tab on or off in Menu bar.'));
        return body;
    },

    /** Switch that adds a widget to the capsule or takes it away. */
    _widgetSwitch(settings, id) {
        const sw = new Gtk.Switch({valign: Gtk.Align.CENTER});
        const sync = () => sw.set_active(settings.get_strv('enabled-widgets').includes(id));
        sw.connect('state-set', (_sw, state) => {
            const list = settings.get_strv('enabled-widgets').filter(w => w !== id);
            if (state)
                list.push(id);
            settings.set_strv('enabled-widgets', list);
            return false;
        });
        settings.connect('changed::enabled-widgets', sync);
        sync();
        return sw;
    },

    _cameraPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);
        this._title(form, _('Camera preview'));
        this._row(form, _('Show in the capsule'), this._widgetSwitch(settings, 'mirror'));
        this._hint(form, _('A mirror: see yourself in the capsule before a call. The camera is on only while the capsule shows it.'));
        return body;
    },

    _scratchpadPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);
        this._title(form, _('Scratchpad'));
        this._row(form, _('Show in the capsule'), this._widgetSwitch(settings, 'notes'));
        this._hint(form, _('Quick notes in separate tabs, kept on this computer.'));
        this._row(form, _('To-do list'), this._widgetSwitch(settings, 'todo'));
        this._hint(form, _('A short list of things to do, next to the notes.'));
        return body;
    },

    _outputPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);
        this._title(form, _('Output switcher'));
        this._pill(form, 'audio-speakers-symbolic', _('Switch output now'), () => this._request(settings, 'output'));
        this._hint(form, _('Switches the sound to the next output: speakers, headphones, a Bluetooth device.'));
        this._shortcutPair(form, settings, 'shortcut-output', '<Control><Alt><Super>o');

        this._title(form, _('Outputs in the cycle'));
        let sinks = [];
        try {
            const [, out] = GLib.spawn_command_line_sync('pactl list sinks');
            const text = new TextDecoder().decode(out);
            for (const block of text.split('\n\n')) {
                const name = /Name: (.+)/.exec(block)?.[1];
                const desc = /Description: (.+)/.exec(block)?.[1];
                if (name)
                    sinks.push([name, desc ?? name]);
            }
        } catch (e) {
            sinks = [];
        }
        if (!sinks.length)
            this._row(form, '', this._dim(_('No sound outputs found.')));
        for (const [name, desc] of sinks) {
            const sw = new Gtk.Switch({valign: Gtk.Align.CENTER, active: !settings.get_strv('output-skipped').includes(name)});
            sw.connect('state-set', (_sw, state) => {
                const list = settings.get_strv('output-skipped').filter(n => n !== name);
                if (!state)
                    list.push(name);
                settings.set_strv('output-skipped', list);
                return false;
            });
            this._row(form, desc, sw);
        }
        this._hint(form, _('Turn an output off to skip it when switching.'));
        return body;
    },

    _radialPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);
        const INFO = {
            'play-pause': [_('Play or pause'), _('Media control'), 'media-playback-start-symbolic'],
            'next': [_('Next track'), _('Media control'), 'media-skip-forward-symbolic'],
            'prev': [_('Previous track'), _('Media control'), 'media-skip-backward-symbolic'],
            'screenshot': [_('Screenshot'), _('Tool'), 'applets-screenshooter-symbolic'],
            'recording': [_('Screen recording'), _('Tool'), 'media-record-symbolic'],
            'color': [_('Color picker'), _('Tool'), 'color-select-symbolic'],
            'downloads': [_('Downloads'), _('Open a file or folder'), 'folder-download-symbolic'],
            'command': [_('Search'), _('Command bar'), 'system-search-symbolic'],
            'clipboard': [_('Clipboard'), _('Clipboard history'), 'edit-paste-symbolic'],
            'dark': [_('Dark mode'), _('Quick toggles'), 'weather-clear-night-symbolic'],
            'night': [_('Night light'), _('Quick toggles'), 'night-light-symbolic'],
            'mic': [_('Mute microphone'), _('Quick toggles'), 'microphone-sensitivity-muted-symbolic'],
            'awake': [_('Keep awake'), _('Tool'), 'weather-clear-night-symbolic'],
            'cleaning': [_('Cleaning mode'), _('Tool'), 'input-keyboard-symbolic'],
            'lock': [_('Lock the screen'), _('Quick toggles'), 'system-lock-screen-symbolic'],
        };
        const DEFAULT = ['play-pause', 'next', 'screenshot', 'downloads', 'color', 'prev'];
        this._title(form, _('Radial menu'));
        this._pill(form, 'view-app-grid-symbolic', _('Open the radial menu'), () => this._request(settings, 'radial'));
        this._hint(form, _('Opens a wheel of your favorite actions around the pointer.'));
        this._shortcutPair(form, settings, 'shortcut-radial', '<Control><Alt><Super>space');

        this._title(form, _('Actions'));
        const card = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8, hexpand: true});
        const wheel = new Gtk.Fixed({width_request: 330, height_request: 330, halign: Gtk.Align.CENTER, css_classes: ['osmin-wheel']});
        const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        const reset = this._button(_('Reset'), () => settings.set_strv('radial-actions', DEFAULT));
        reset.halign = Gtk.Align.END;
        const add = new Gtk.MenuButton({label: _('Add action'), icon_name: 'list-add-symbolic', css_classes: ['osmin-pill'], halign: Gtk.Align.START});
        const pop = new Gtk.Popover();
        const popBox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        pop.set_child(popBox);
        add.set_popover(pop);
        const clear = box => {
            let c = box.get_first_child();
            while (c) {
                box.remove(c);
                c = box.get_first_child();
            }
        };
        const draw = () => {
            const ids = settings.get_strv('radial-actions').filter(id => INFO[id]);
            clear(wheel);
            clear(list);
            clear(popBox);
            wheel.put(new Gtk.Image({icon_name: 'view-app-grid-symbolic', pixel_size: 28, css_classes: ['osmin-hub']}), 151, 151);
            ids.forEach((id, i) => {
                const angle = -Math.PI / 2 + 2 * Math.PI * i / Math.max(ids.length, 1);
                const b = new Gtk.Button({css_classes: ['osmin-wheel-btn'], child: new Gtk.Image({icon_name: INFO[id][2], pixel_size: 20})});
                b.connect('clicked', () => settings.set_strv('radial-actions', ids.filter(x => x !== id)));
                b.tooltip_text = _('Click to remove');
                wheel.put(b, 165 + Math.cos(angle) * 110 - 22, 165 + Math.sin(angle) * 110 - 22);
            });
            ids.forEach((id, i) => {
                const row = new Gtk.Box({spacing: 10, margin_top: 6, margin_bottom: 6});
                row.append(new Gtk.Image({icon_name: INFO[id][2], pixel_size: 22}));
                const texts = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, hexpand: true});
                texts.append(new Gtk.Label({label: INFO[id][0], xalign: 0}));
                texts.append(this._dim(INFO[id][1]));
                row.append(texts);
                const move = (by) => {
                    const next = [...ids];
                    const j = i + by;
                    if (j < 0 || j >= next.length)
                        return;
                    [next[i], next[j]] = [next[j], next[i]];
                    settings.set_strv('radial-actions', next);
                };
                const up = Gtk.Button.new_from_icon_name('go-up-symbolic');
                up.connect('clicked', () => move(-1));
                up.sensitive = i > 0;
                const down = Gtk.Button.new_from_icon_name('go-down-symbolic');
                down.connect('clicked', () => move(1));
                down.sensitive = i < ids.length - 1;
                const del = Gtk.Button.new_from_icon_name('edit-delete-symbolic');
                del.connect('clicked', () => settings.set_strv('radial-actions', ids.filter(x => x !== id)));
                for (const b of [up, down, del])
                    b.add_css_class('flat');
                row.append(up);
                row.append(down);
                row.append(del);
                list.append(row);
                if (i < ids.length - 1)
                    list.append(new Gtk.Separator());
            });
            for (const id of Object.keys(INFO).filter(x => !ids.includes(x))) {
                const item = new Gtk.Button({css_classes: ['flat'], child: new Gtk.Label({label: INFO[id][0], xalign: 0})});
                item.connect('clicked', () => {
                    pop.popdown();
                    settings.set_strv('radial-actions', [...ids, id].slice(0, 8));
                });
                popBox.append(item);
            }
            add.sensitive = ids.length < 8 && popBox.get_first_child() !== null;
        };
        settings.connect('changed::radial-actions', draw);
        draw();
        card.append(reset);
        card.append(wheel);
        this._row(form, '', card);
        this._hint(form, _('Click a button of the wheel to remove it. Add up to eight actions.'));
        const addWrap = new Gtk.Box({hexpand: true});
        addWrap.append(add);
        this._row(form, '', addWrap);
        this._row(form, '', list);
        return body;
    },
};
