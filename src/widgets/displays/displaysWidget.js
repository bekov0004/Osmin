import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {HorizontalSlider} from '../../ui/horizontalSlider.js';
import {checkRow, collapsible, iconRow, menuCard, menuDivider} from '../../ui/menuKit.js';
import {OsminWidget} from '../widget.js';

const POWER_SCHEMA = 'org.gnome.settings-daemon.plugins.power';

/**
 * Displays: the brightness of the built-in screen, of external monitors that answer DDC (when
 * `ddcutil` is installed) and of the keyboard light, plus night light and automatic brightness.
 */
export class DisplaysWidget extends OsminWidget {
    static id = 'displays';
    static title = 'Displays';
    static iconName = 'video-display-symbolic';
    static menuNative = true;

    constructor(context) {
        super(context);
        this._screen = null;
        this._keyboard = null;
        this._cancellable = new Gio.Cancellable();
        this._monitors = [];   // {label, slider, value, set}
        try {
            this._color = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'});
        } catch (e) {
            this._color = null;
        }
        try {
            this._power = new Gio.Settings({schema_id: POWER_SCHEMA});
        } catch (e) {
            this._power = null;
        }
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-displays osmin-menu-page', x_expand: true});
        const card = menuCard();
        card.add_style_class_name('osmin-bigcard');
        root.add_child(card);

        this._list = new St.BoxLayout({vertical: true, x_expand: true});
        card.add_child(this._list);

        this._kbdBox = new St.BoxLayout({vertical: true, x_expand: true, visible: false});
        this._kbdBox.add_child(menuDivider());
        this._kbd = this._sliderRow('input-keyboard-symbolic', 'Keyboard light', value => this._setKeyboard(value));
        this._kbdBox.add_child(this._kbd.actor);
        card.add_child(this._kbdBox);
        this._firstDivider = menuDivider();
        card.add_child(this._firstDivider);

        const switches = [
            ['Night light', 'weather-clear-night-symbolic', () => this._color?.get_boolean('night-light-enabled'), on => this._color?.set_boolean('night-light-enabled', on)],
            ['Automatic brightness', 'display-brightness-symbolic', () => this._power?.get_boolean('ambient-enabled'), on => this._power?.set_boolean('ambient-enabled', on)],
        ];
        this._switches = [];
        for (const [title, icon, get, set] of switches) {
            if ((title === 'Night light' && !this._color) || (title !== 'Night light' && !this._power))
                continue;
            const toggle = new PopupMenu.Switch(false);
            const {row} = iconRow({icon, title, control: toggle, onClick: () => set(!toggle.state)});
            row.add_style_class_name('osmin-option-line');
            card.add_child(row);
            card.add_child(menuDivider());
            this._switches.push({toggle, get});
        }
        this._color?.connectObject('changed::night-light-enabled', () => this._sync(), this);
        this._power?.connectObject('changed', () => this._sync(), this);

        const options = collapsible('Options', {open: true});
        card.add_child(options.actor);
        if (this._power) {
            this._dim = checkRow({title: 'Dim the screen when inactive', subtitle: 'The screen gets darker after a while without activity.', state: this._power.get_boolean('idle-dim'), onToggle: on => this._power.set_boolean('idle-dim', on)});
            options.body.add_child(this._dim.row);
        }
        if (this._hasDdc()) {
            this._note = null;
        } else {
            this._note = new St.Label({text: 'Install ddcutil to control the brightness of external monitors.', style_class: 'osmin-hint'});
            options.body.add_child(this._note);
        }

        this._firstDivider.visible = false;
        this._connectScreen();
        this._connectKeyboard();
        this._probeExternal();
        this._sync();
        return root;
    }

    /** A named slider with the percent and a power button on the right. */
    _sliderRow(icon, name, onChange) {
        const actor = new St.BoxLayout({vertical: true, x_expand: true});
        const head = new St.BoxLayout({style_class: 'osmin-value-row', x_expand: true});
        head.add_child(new St.Icon({icon_name: icon, style_class: 'osmin-meter-icon', y_align: Clutter.ActorAlign.CENTER}));
        head.add_child(new St.Label({text: name, style_class: 'osmin-value-label osmin-value-strong', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        const percent = new St.Label({text: '', style_class: 'osmin-value-muted', y_align: Clutter.ActorAlign.CENTER});
        head.add_child(percent);
        actor.add_child(head);
        const slider = new HorizontalSlider({min: 0, max: 100, value: 50, onChange: value => {
            percent.text = `${Math.round(value)}%`;
            onChange(Math.round(value));
        }});
        const wrap = new St.BoxLayout({style_class: 'osmin-slider-row', x_expand: true});
        wrap.add_child(slider);
        actor.add_child(wrap);
        return {actor, slider, set: value => {
            slider.value = value;
            percent.text = `${Math.round(value)}%`;
        }};
    }

    _sync() {
        this._switches?.forEach(({toggle, get}) => (toggle.state = !!get()));
        this._dim?.set(this._power?.get_boolean('idle-dim') ?? false);
    }

    // The built-in screen, through GNOME's power settings service.
    _connectScreen() {
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null, 'org.gnome.SettingsDaemon.Power',
            '/org/gnome/SettingsDaemon/Power', 'org.gnome.SettingsDaemon.Power.Screen', this._cancellable, (_o, result) => {
                try {
                    this._screen = Gio.DBusProxy.new_for_bus_finish(result);
                } catch (e) {
                    return;
                }
                this._screen.connectObject('g-properties-changed', () => this._syncScreen(), this);
                this._syncScreen();
            });
    }

    _syncScreen() {
        const value = this._screen?.get_cached_property('Brightness')?.get_int32() ?? -1;
        if (value < 0)
            return;
        if (!this._builtin) {
            this._builtin = this._sliderRow('computer-symbolic', 'Built-in display', percent => this._setScreen(percent));
            this._list.insert_child_at_index(this._builtin.actor, 0);
        }
        this._builtin.set(value);
        this._firstDivider.visible = true;
    }

    _setScreen(percent) {
        this._screen?.get_connection().call(this._screen.get_name(), this._screen.get_object_path(), 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['org.gnome.SettingsDaemon.Power.Screen', 'Brightness', new GLib.Variant('i', percent)]),
            null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    // The keyboard light, through UPower.
    _connectKeyboard() {
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, 'org.freedesktop.UPower',
            '/org/freedesktop/UPower/KbdBacklight', 'org.freedesktop.UPower.KbdBacklight', this._cancellable, (_o, result) => {
                try {
                    this._keyboard = Gio.DBusProxy.new_for_bus_finish(result);
                    this._keyboard.call_sync('GetMaxBrightness', null, Gio.DBusCallFlags.NONE, 500, null).deepUnpack();
                } catch (e) {
                    this._keyboard = null;
                    return;
                }
                this._keyboard.connectObject('g-signal', () => this._syncKeyboard(), this);
                this._kbdBox.visible = true;
                this._syncKeyboard();
            });
    }

    _syncKeyboard() {
        try {
            const [max] = this._keyboard.call_sync('GetMaxBrightness', null, Gio.DBusCallFlags.NONE, 500, null).deepUnpack();
            const [now] = this._keyboard.call_sync('GetBrightness', null, Gio.DBusCallFlags.NONE, 500, null).deepUnpack();
            this._kbdMax = max;
            this._kbd.set(max > 0 ? Math.round(100 * now / max) : 0);
        } catch (e) {
            // the keyboard light went away
        }
    }

    _setKeyboard(percent) {
        this._keyboard?.call('SetBrightness', new GLib.Variant('(i)', [Math.round((this._kbdMax ?? 1) * percent / 100)]), Gio.DBusCallFlags.NONE, 500, null, null);
    }

    // External monitors through DDC/CI (needs ddcutil).
    _hasDdc() {
        return !!GLib.find_program_in_path('ddcutil');
    }

    _probeExternal() {
        if (!this._hasDdc())
            return;
        try {
            const proc = Gio.Subprocess.new(['ddcutil', 'detect', '--brief'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, this._cancellable, (_p, result) => {
                try {
                    const [, out] = proc.communicate_utf8_finish(result);
                    for (const block of out.split(/\n(?=Display )/)) {
                        const number = block.match(/^Display (\d+)/)?.[1];
                        const name = block.match(/Monitor:\s+\S*?:([^:\n]+)/)?.[1]?.trim() || `Monitor ${number}`;
                        if (number)
                            this._addExternal(Number(number), name);
                    }
                } catch (e) {
                    // no DDC monitors
                }
            });
        } catch (e) {
            // ddcutil is not usable
        }
    }

    _addExternal(number, name) {
        const row = this._sliderRow('video-display-symbolic', name, percent => {
            GLib.spawn_async(null, ['ddcutil', '--display', String(number), 'setvcp', '10', String(percent)], null, GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.STDOUT_TO_DEV_NULL | GLib.SpawnFlags.STDERR_TO_DEV_NULL, null);
        });
        this._list.add_child(row.actor);
        try {
            const proc = Gio.Subprocess.new(['ddcutil', '--display', String(number), 'getvcp', '10', '--brief'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, this._cancellable, (_p, result) => {
                try {
                    const [, out] = proc.communicate_utf8_finish(result);
                    const m = out.match(/VCP 10 C (\d+) (\d+)/);
                    if (m)
                        row.set(Math.round(100 * Number(m[1]) / Number(m[2])));
                } catch (e) {
                    // unreadable
                }
            });
        } catch (e) {
            // ignore
        }
    }

    onPageShown() {
        this._syncScreen();
        if (this._keyboard)
            this._syncKeyboard();
        this._sync();
    }

    destroy() {
        this._cancellable.cancel();
        this._color?.disconnectObject(this);
        this._power?.disconnectObject(this);
        this._screen?.disconnectObject(this);
        this._keyboard?.disconnectObject(this);
        super.destroy();
    }
}
