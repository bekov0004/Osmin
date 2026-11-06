import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {startCleaningMode} from './cleaningMode.js';
import {pickColor} from './colorPicker.js';
import {EventType} from '../utils/events.js';

/**
 * What the tool pages do, in one place: keep awake, dark mode, night light, lock, eject, empty the
 * trash, screenshot and recording, colour picker, cleaning mode, mute the microphone, turn the
 * screen off. The pages (Keep awake, Utilities, Quick toggles ...) only show buttons for these.
 */
export class ToolActions {
    constructor(context) {
        this.context = context;
        this._events = context.events;
        this._power = context.services.backend?.power;
        this._tools = context.services.backend?.tools;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        try {
            this._color = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'});
        } catch (e) {
            this._color = null;
        }
        this._cleaning = null;
        this._trashArmed = 0;
    }

    get power() {
        return this._power;
    }

    get awake() {
        const state = this._power?.state ?? {until: 0, forever: false};
        return {...state, active: !!(state.forever || state.until > Date.now())};
    }

    get dark() {
        return this._interface.get_string('color-scheme') === 'prefer-dark';
    }

    get night() {
        return this._color?.get_boolean('night-light-enabled') ?? false;
    }

    /** Calls `callback` when the colour scheme or the night light changes. */
    watch(owner, callback) {
        this._interface.connectObject('changed::color-scheme', callback, owner);
        this._color?.connectObject('changed::night-light-enabled', callback, owner);
        this._power?.connectObject('state-changed', callback, owner);
    }

    unwatch(owner) {
        this._interface?.disconnectObject(owner);
        this._color?.disconnectObject(owner);
        this._power?.disconnectObject(owner);
    }

    async setAwake(minutes) {
        try {
            await this._power.call('setAwake', {minutes});
            this.say('weather-clear-night-symbolic', minutes === 0 ? 'Keep awake is off' : 'Keeping the computer awake',
                minutes > 0 ? `for ${minutes} minutes` : minutes < 0 ? 'until you turn it off' : '');
        } catch (e) {
            this.say('dialog-warning-symbolic', 'Keep awake', e.message);
        }
    }

    say(icon, title, description = '') {
        this._events.emit({type: EventType.CUSTOM, icon, title, description, duration: 3000});
    }

    /** Mutes or unmutes the microphone for every application (PipeWire / PulseAudio). */
    toggleMic() {
        try {
            GLib.spawn_command_line_async('pactl set-source-mute @DEFAULT_SOURCE@ toggle');
            this.say('microphone-sensitivity-muted-symbolic', 'Microphone', 'Muted or unmuted');
        } catch (e) {
            this.say('dialog-warning-symbolic', 'Microphone', e.message);
        }
    }

    /** Turns the display off until a key is pressed or the mouse moves. */
    screenOff() {
        try {
            GLib.spawn_command_line_async('gdbus call --session --dest org.gnome.Mutter.DisplayConfig --object-path /org/gnome/Mutter/DisplayConfig --method org.freedesktop.DBus.Properties.Set org.gnome.Mutter.DisplayConfig PowerSaveMode "<int32 1>"');
        } catch (e) {
            this.say('dialog-warning-symbolic', 'Screen off', e.message);
        }
    }

    toggleDark() {
        const dark = this._interface.get_string('color-scheme') === 'prefer-dark';
        this._interface.set_string('color-scheme', dark ? 'default' : 'prefer-dark');
    }

    toggleNight() {
        this._color?.set_boolean('night-light-enabled', !this._color.get_boolean('night-light-enabled'));
    }

    /** The removable drives that can be taken out (USB sticks, cards ...). */
    ejectables() {
        return Gio.VolumeMonitor.get().get_mounts().filter(mount => {
            const path = mount.get_root()?.get_path() ?? '';
            return !mount.is_shadowed() && (mount.can_eject() || mount.can_unmount()) &&
                (path.startsWith('/media/') || path.startsWith('/run/media/'));
        });
    }

    ejectAll() {
        const mounts = this.ejectables();
        if (mounts.length === 0) {
            this.say('media-eject-symbolic', 'Nothing to eject', 'No USB drives or cards are connected');
            return;
        }
        for (const mount of mounts) {
            const done = (object, result, eject) => {
                try {
                    if (eject)
                        mount.eject_with_operation_finish(result);
                    else
                        mount.unmount_with_operation_finish(result);
                    this.say('media-eject-symbolic', `${mount.get_name()} can be removed`, '');
                } catch (e) {
                    this.say('dialog-warning-symbolic', `Could not eject ${mount.get_name()}`, e.message);
                }
            };
            if (mount.can_eject())
                mount.eject_with_operation(Gio.MountUnmountFlags.NONE, null, null, (o, r) => done(o, r, true));
            else
                mount.unmount_with_operation(Gio.MountUnmountFlags.NONE, null, null, (o, r) => done(o, r, false));
        }
    }

    lock() {
        Main.screenShield.lock(true);
    }

    /** Irreversible: the first press asks ("Sure?"), a second one within 3 seconds does it. */
    async emptyTrash(setLabel = () => {}) {
        const label = {set text(value) {
            setLabel(value);
        }};
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
            this.say('user-trash-symbolic', count === 0 ? 'The trash is empty' : 'Trash emptied', count > 0 ? `${count} items removed` : '');
        } catch (e) {
            this.say('dialog-warning-symbolic', 'Empty trash', e.message);
        }
    }

    /** @param {number} mode 0: screenshot, 1: screen recording */
    screenshot(mode) {
        this.context.ui?.closeCapsule?.();
        // Let the capsule close first, so it is not in the picture.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
            try {
                Main.screenshotUI.open(mode);
            } catch (e) {
                this.say('dialog-warning-symbolic', 'Screenshot', e.message);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    async pickColor() {
        this.context.ui?.closeCapsule?.();
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        }));
        const color = await pickColor();
        if (!color)
            return;
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, color.hex);
        this.say('color-select-symbolic', `${color.hex} copied`, `${color.rgb}  ·  ${color.hsl}`);
    }

    cleaningMode() {
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

    /** Starts the screen saver (locks the screen). */
    screensaver() {
        Main.screenShield.lock(true);
    }

    destroy() {
        this._cleaning?.end();
        if (this._trashArmed)
            GLib.source_remove(this._trashArmed);
    }
}
