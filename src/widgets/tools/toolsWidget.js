import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {startCleaningMode} from '../../tools/cleaningMode.js';
import {pickColor} from '../../tools/colorPicker.js';
import {EventType} from '../../utils/events.js';
import {OsminWidget} from '../widget.js';

const AWAKE_STEPS = [30, 60, 120, -1, 0]; // minutes; -1 until turned off; 0 off

const awakeText = state => {
    if (state.forever)
        return '∞';
    if (state.until > Date.now())
        return `${Math.ceil((state.until - Date.now()) / 60000)}m`;
    return 'Awake';
};

/**
 * Quick toggles and tools in one place: keep awake, dark mode, night light, lock the screen, empty
 * the trash, screenshot, screen recording, a colour picker and a cleaning mode.
 */
export class ToolsWidget extends OsminWidget {
    static id = 'tools';
    static title = 'Quick Toggles';
    static iconName = 'applications-utilities-symbolic';

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
        this._tiles = new Map();
        this._cleaning = null;
        this._trashArmed = 0;
    }

    createView() {
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-widget osmin-tools',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const tools = [
            ['awake', 'weather-clear-night-symbolic', 'Awake', () => this._cycleAwake()],
            ['dark', 'night-light-symbolic', 'Dark', () => this._toggleDark()],
            ['night', 'weather-clear-night-symbolic', 'Night', () => this._toggleNight()],
            ['lock', 'system-lock-screen-symbolic', 'Lock', () => this._lock()],
            ['trash', 'user-trash-symbolic', 'Trash', () => this._emptyTrash()],
            ['shot', 'applets-screenshooter-symbolic', 'Shot', () => this._screenshot(0)],
            ['record', 'media-record-symbolic', 'Record', () => this._screenshot(1)],
            ['color', 'color-select-symbolic', 'Color', () => this._pickColor()],
            ['clean', 'edit-clear-all-symbolic', 'Clean', () => this._cleaningMode()],
        ];
        const perRow = 5;
        let row = null;
        tools.forEach(([id, icon, label, action], index) => {
            if (index % perRow === 0) {
                row = new St.BoxLayout({style_class: 'osmin-tools-row', x_expand: true});
                root.add_child(row);
            }
            row.add_child(this._createTile(id, icon, label, action));
        });

        this._interface.connectObject('changed::color-scheme', () => this._update(), this);
        this._color?.connectObject('changed::night-light-enabled', () => this._update(), this);
        this._power?.connectObject('state-changed', () => this._update(), this);
        this._update();
        return root;
    }

    _createTile(id, iconName, label, action) {
        const tile = new St.Button({style_class: 'osmin-tool', can_focus: true, x_expand: true, reactive: true, track_hover: true});
        const box = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER});
        box.add_child(new St.Icon({icon_name: iconName, style_class: 'osmin-tool-icon', x_align: Clutter.ActorAlign.CENTER}));
        const text = new St.Label({text: label, style_class: 'osmin-tool-label', x_align: Clutter.ActorAlign.CENTER});
        box.add_child(text);
        tile.set_child(box);
        tile.connect('clicked', () => action());
        this._tiles.set(id, {tile, text, label});
        return tile;
    }

    _update() {
        const dark = this._interface.get_string('color-scheme') === 'prefer-dark';
        const night = this._color?.get_boolean('night-light-enabled') ?? false;
        const awake = this._power?.state ?? {until: 0, forever: false};
        const active = awake.forever || awake.until > Date.now();
        for (const [id, on] of [['dark', dark], ['night', night], ['awake', active]]) {
            const entry = this._tiles.get(id);
            if (!entry)
                continue;
            if (on)
                entry.tile.add_style_pseudo_class('checked');
            else
                entry.tile.remove_style_pseudo_class('checked');
        }
        const awakeTile = this._tiles.get('awake');
        if (awakeTile)
            awakeTile.text.text = awakeText(awake);
        const nightTile = this._tiles.get('night');
        if (nightTile && !this._color)
            nightTile.tile.visible = false;
    }

    onPageShown() {
        this._update();
    }

    _say(icon, title, description = '') {
        this._events.emit({type: EventType.CUSTOM, icon, title, description, duration: 3000});
    }

    async _cycleAwake() {
        const state = this._power?.state ?? {};
        const active = state.forever || state.until > Date.now();
        // off -> 30 min -> 1 h -> 2 h -> until turned off -> off
        let next = AWAKE_STEPS[0];
        if (active) {
            const left = state.forever ? Infinity : Math.round((state.until - Date.now()) / 60000);
            next = left === Infinity ? 0 : left > 90 ? -1 : left > 40 ? 120 : 60;
        }
        try {
            await this._power.call('setAwake', {minutes: next});
            this._say('weather-clear-night-symbolic', next === 0 ? 'Keep awake is off' : 'Keeping the computer awake',
                next > 0 ? `for ${next} minutes` : next < 0 ? 'until you turn it off' : '');
        } catch (e) {
            this._say('dialog-warning-symbolic', 'Keep awake', e.message);
        }
    }

    _toggleDark() {
        const dark = this._interface.get_string('color-scheme') === 'prefer-dark';
        this._interface.set_string('color-scheme', dark ? 'default' : 'prefer-dark');
    }

    _toggleNight() {
        this._color?.set_boolean('night-light-enabled', !this._color.get_boolean('night-light-enabled'));
    }

    _lock() {
        Main.screenShield.lock(true);
    }

    /** Irreversible: the first press asks ("Sure?"), a second one within 3 seconds does it. */
    async _emptyTrash() {
        const entry = this._tiles.get('trash');
        if (!this._trashArmed) {
            this._trashArmed = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
                this._trashArmed = 0;
                entry.text.text = entry.label;
                return GLib.SOURCE_REMOVE;
            });
            entry.text.text = 'Sure?';
            return;
        }
        GLib.source_remove(this._trashArmed);
        this._trashArmed = 0;
        entry.text.text = entry.label;
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
        this._cleaning?.end();
        if (this._trashArmed)
            GLib.source_remove(this._trashArmed);
        super.destroy();
    }
}
