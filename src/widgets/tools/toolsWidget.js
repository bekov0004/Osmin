import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {HorizontalSlider} from '../../ui/horizontalSlider.js';
import {menuCard, menuChips, menuDivider, menuHeader, setChecked, switchRow} from '../../ui/menuKit.js';
import {startCleaningMode} from '../../tools/cleaningMode.js';
import {pickColor} from '../../tools/colorPicker.js';
import {EventType} from '../../utils/events.js';
import {OsminWidget} from '../widget.js';

const AWAKE_CHIPS = [[15, '15m'], [30, '30m'], [60, '1h'], [120, '2h'], [240, '4h'], [480, '8h'], [-1, '∞']]; // minutes; -1 until turned off

/**
 * Quick toggles and tools in one place: keep awake, dark mode, night light, lock the screen, empty
 * the trash, screenshot, screen recording, a colour picker and a cleaning mode.
 */
export class ToolsWidget extends OsminWidget {
    static id = 'tools';
    static title = 'Quick Toggles';
    static iconName = 'applications-utilities-symbolic';
    static menuNative = true; // laid out with the menu kit: the menu does not wrap it

    constructor(context) {
        super(context);
        this._events = context.events;
        this._power = context.services.backend?.power;
        this._tools = context.services.backend?.tools;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        try {
            this._color = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'});
        } catch (e) {
            this._color = null;
        }
        this._chipOn = null;
        this._cleaning = null;
        this._trashArmed = 0;
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-tools osmin-menu-page', x_expand: true});

        // Keep awake: a switch for "until I turn it off", chips for a time.
        root.add_child(menuHeader('Keep awake'));
        const awakeCard = menuCard();
        this._awake = switchRow({
            title: 'Keep the computer awake',
            subtitle: 'The computer follows its normal energy rules',
            onToggle: on => this._setAwake(on ? -1 : 0),
        });
        awakeCard.add_child(this._awake.row);
        awakeCard.add_child(menuDivider());
        const chips = menuChips(AWAKE_CHIPS.map(([minutes, label]) => ({id: String(minutes), label})), id => this._chip(Number(id)), {perRow: 7});
        chips.actor.add_style_class_name('osmin-card-pad');
        awakeCard.add_child(chips.actor);
        this._awakeChips = chips.buttons;
        awakeCard.add_child(new St.Label({text: 'Click a time to start. Click it again to stop.', style_class: 'osmin-card-hint'}));
        root.add_child(awakeCard);

        // Appearance and display.
        root.add_child(menuHeader('Display'));
        const displayCard = menuCard();
        this._dark = switchRow({title: 'Dark mode', subtitle: 'The system colour scheme', onToggle: () => this._toggleDark()});
        displayCard.add_child(this._dark.row);
        if (this._color) {
            displayCard.add_child(menuDivider());
            this._night = switchRow({title: 'Night light', subtitle: 'Warmer colours in the evening', onToggle: () => this._toggleNight()});
            displayCard.add_child(this._night.row);
        }
        this._createBrightness(displayCard);
        root.add_child(displayCard);

        // One-shot actions.
        root.add_child(menuHeader('Quick actions'));
        const actionsCard = menuCard();
        const actions = menuChips([
            {id: 'lock', label: 'Lock', icon: 'system-lock-screen-symbolic'},
            {id: 'shot', label: 'Screenshot', icon: 'applets-screenshooter-symbolic'},
            {id: 'record', label: 'Record', icon: 'media-record-symbolic'},
            {id: 'color', label: 'Colour', icon: 'color-select-symbolic'},
            {id: 'clean', label: 'Clean screen', icon: 'edit-clear-all-symbolic'},
            {id: 'eject', label: 'Eject', icon: 'media-eject-symbolic'},
            {id: 'trash', label: 'Empty trash', icon: 'user-trash-symbolic'},
            {id: 'mic', label: 'Mute mic', icon: 'microphone-sensitivity-muted-symbolic'},
            {id: 'screenoff', label: 'Screen off', icon: 'video-display-symbolic'},
        ], id => this._action(id), {perRow: 3});
        actions.actor.add_style_class_name('osmin-card-pad');
        actionsCard.add_child(actions.actor);
        this._trashChip = actions.buttons.get('trash');
        root.add_child(actionsCard);

        this._interface.connectObject('changed::color-scheme', () => this._update(), this);
        this._color?.connectObject('changed::night-light-enabled', () => this._update(), this);
        this._power?.connectObject('state-changed', () => this._update(), this);
        this._update();
        return root;
    }

    _action(id) {
        const run = {
            lock: () => this._lock(),
            shot: () => this._screenshot(0),
            record: () => this._screenshot(1),
            color: () => this._pickColor(),
            clean: () => this._cleaningMode(),
            eject: () => this._ejectAll(),
            trash: () => this._emptyTrash(),
            mic: () => this._toggleMic(),
            screenoff: () => this._screenOff(),
        }[id];
        run?.();
    }

    async _setAwake(minutes) {
        try {
            await this._power.call('setAwake', {minutes});
            this._say('weather-clear-night-symbolic', minutes === 0 ? 'Keep awake is off' : 'Keeping the computer awake',
                minutes > 0 ? `for ${minutes} minutes` : minutes < 0 ? 'until you turn it off' : '');
        } catch (e) {
            this._say('dialog-warning-symbolic', 'Keep awake', e.message);
        }
    }

    /** A chip starts that time; the same chip again (or any while it runs and matches) stops it. */
    _chip(minutes) {
        const state = this._power?.state ?? {};
        const active = state.forever || state.until > Date.now();
        if (active && this._chipOn === minutes)
            this._setAwake(0);
        else
            this._setAwake(minutes);
        this._chipOn = minutes;
    }

    /** A brightness slider for the built-in screen, through GNOME's power settings service. */
    _createBrightness(card) {
        const row = new St.BoxLayout({style_class: 'osmin-card-row osmin-tools-brightness', x_expand: true, visible: false});
        row.add_child(new St.Icon({icon_name: 'display-brightness-symbolic', style_class: 'osmin-tool-icon', y_align: Clutter.ActorAlign.CENTER}));
        this._brightness = new HorizontalSlider({min: 0, max: 100, value: 50, onChange: value => this._setBrightness(Math.round(value))});
        this._brightness.y_align = Clutter.ActorAlign.CENTER;
        row.add_child(this._brightness);
        this._brightnessDivider = menuDivider();
        this._brightnessDivider.visible = false;
        card.add_child(this._brightnessDivider);
        card.add_child(row);
        this._brightnessRow = row;
        this._cancellable = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null, 'org.gnome.SettingsDaemon.Power',
            '/org/gnome/SettingsDaemon/Power', 'org.gnome.SettingsDaemon.Power.Screen', this._cancellable, (_o, result) => {
                try {
                    this._screen = Gio.DBusProxy.new_for_bus_finish(result);
                } catch (e) {
                    return; // no power settings service: no slider
                }
                this._screen.connectObject('g-properties-changed', () => this._syncBrightness(), this);
                this._syncBrightness();
            });
    }

    _syncBrightness() {
        const value = this._screen?.get_cached_property('Brightness')?.get_int32() ?? -1;
        this._brightnessRow.visible = this._brightnessDivider.visible = value >= 0;
        if (value >= 0)
            this._brightness.value = value;
    }

    _setBrightness(percent) {
        this._screen?.get_connection().call(this._screen.get_name(), this._screen.get_object_path(), 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['org.gnome.SettingsDaemon.Power.Screen', 'Brightness', new GLib.Variant('i', percent)]),
            null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    _update() {
        const dark = this._interface.get_string('color-scheme') === 'prefer-dark';
        const night = this._color?.get_boolean('night-light-enabled') ?? false;
        const awake = this._power?.state ?? {until: 0, forever: false};
        const active = awake.forever || awake.until > Date.now();
        this._dark.set(dark);
        this._night?.set(night);
        this._awake.set(active);
        this._awake.setSubtitle(awake.forever ? 'Until you turn it off'
            : awake.until > Date.now() ? `${Math.ceil((awake.until - Date.now()) / 60000)} minutes left`
                : 'The computer follows its normal energy rules');
        for (const [minutes, chip] of this._awakeChips)
            setChecked(chip, active && (awake.forever ? minutes === '-1' : minutes === String(this._chipOn)));
    }

    onPageShown() {
        this._update();
    }

    _say(icon, title, description = '') {
        this._events.emit({type: EventType.CUSTOM, icon, title, description, duration: 3000});
    }

    /** Mutes or unmutes the microphone for every application (PipeWire / PulseAudio). */
    _toggleMic() {
        try {
            GLib.spawn_command_line_async('pactl set-source-mute @DEFAULT_SOURCE@ toggle');
            this._say('microphone-sensitivity-muted-symbolic', 'Microphone', 'Muted or unmuted');
        } catch (e) {
            this._say('dialog-warning-symbolic', 'Microphone', e.message);
        }
    }

    /** Turns the display off until a key is pressed or the mouse moves. */
    _screenOff() {
        try {
            GLib.spawn_command_line_async('gdbus call --session --dest org.gnome.Mutter.DisplayConfig --object-path /org/gnome/Mutter/DisplayConfig --method org.freedesktop.DBus.Properties.Set org.gnome.Mutter.DisplayConfig PowerSaveMode "<int32 1>"');
        } catch (e) {
            this._say('dialog-warning-symbolic', 'Screen off', e.message);
        }
    }

    _toggleDark() {
        const dark = this._interface.get_string('color-scheme') === 'prefer-dark';
        this._interface.set_string('color-scheme', dark ? 'default' : 'prefer-dark');
    }

    _toggleNight() {
        this._color?.set_boolean('night-light-enabled', !this._color.get_boolean('night-light-enabled'));
    }

    /** The removable drives that can be taken out (USB sticks, cards ...). */
    _ejectables() {
        return Gio.VolumeMonitor.get().get_mounts().filter(mount => {
            const path = mount.get_root()?.get_path() ?? '';
            return !mount.is_shadowed() && (mount.can_eject() || mount.can_unmount()) &&
                (path.startsWith('/media/') || path.startsWith('/run/media/'));
        });
    }

    _ejectAll() {
        const mounts = this._ejectables();
        if (mounts.length === 0) {
            this._say('media-eject-symbolic', 'Nothing to eject', 'No USB drives or cards are connected');
            return;
        }
        for (const mount of mounts) {
            const done = (object, result, eject) => {
                try {
                    if (eject)
                        mount.eject_with_operation_finish(result);
                    else
                        mount.unmount_with_operation_finish(result);
                    this._say('media-eject-symbolic', `${mount.get_name()} can be removed`, '');
                } catch (e) {
                    this._say('dialog-warning-symbolic', `Could not eject ${mount.get_name()}`, e.message);
                }
            };
            if (mount.can_eject())
                mount.eject_with_operation(Gio.MountUnmountFlags.NONE, null, null, (o, r) => done(o, r, true));
            else
                mount.unmount_with_operation(Gio.MountUnmountFlags.NONE, null, null, (o, r) => done(o, r, false));
        }
    }

    _lock() {
        Main.screenShield.lock(true);
    }

    /** Irreversible: the first press asks ("Sure?"), a second one within 3 seconds does it. */
    async _emptyTrash() {
        const label = this._trashChip.get_child().get_last_child();
        if (!this._trashArmed) {
            this._trashArmed = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
                this._trashArmed = 0;
                label.text = 'Empty trash';
                return GLib.SOURCE_REMOVE;
            });
            label.text = 'Sure?';
            return;
        }
        GLib.source_remove(this._trashArmed);
        this._trashArmed = 0;
        label.text = 'Empty trash';
        try {
            const {count} = await this._tools.call('emptyTrash');
            this._say('user-trash-symbolic', count === 0 ? 'The trash is empty' : 'Trash emptied', count > 0 ? `${count} items removed` : '');
        } catch (e) {
            this._say('dialog-warning-symbolic', 'Empty trash', e.message);
        }
    }

    /** @param {number} mode 0: screenshot, 1: screen recording */
    _screenshot(mode) {
        this.context.ui?.closeCapsule?.();
        // Let the capsule close first, so it is not in the picture.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
            try {
                Main.screenshotUI.open(mode);
            } catch (e) {
                this._say('dialog-warning-symbolic', 'Screenshot', e.message);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    async _pickColor() {
        this.context.ui?.closeCapsule?.();
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        }));
        const color = await pickColor();
        if (!color)
            return;
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, color.hex);
        this._say('color-select-symbolic', `${color.hex} copied`, `${color.rgb}  ·  ${color.hsl}`);
    }

    _cleaningMode() {
        if (this._cleaning)
            return;
        this.context.ui?.closeCapsule?.();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
            this._cleaning = startCleaningMode({onEnd: () => {
                this._cleaning = null;
            }});
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this._interface?.disconnectObject(this);
        this._color?.disconnectObject(this);
        this._power?.disconnectObject(this);
        this._cancellable?.cancel();
        this._screen?.disconnectObject(this);
        this._cleaning?.end();
        if (this._trashArmed)
            GLib.source_remove(this._trashArmed);
        super.destroy();
    }
}
