import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {OsminWidget} from '../widget.js';

/**
 * Mouse and keyboard switches: GNOME's own settings, put in one place. Each one flips one
 * setting (nothing else is changed) and shows its current state; turning it back is one press.
 */
const SWITCHES = [
    {id: 'mouse-scroll', label: 'Mouse scroll', hint: 'Natural scrolling for the mouse wheel', schema: 'org.gnome.desktop.peripherals.mouse', key: 'natural-scroll', icon: 'input-mouse-symbolic'},
    {id: 'touchpad-scroll', label: 'Touchpad scroll', hint: 'Natural scrolling for the touchpad', schema: 'org.gnome.desktop.peripherals.touchpad', key: 'natural-scroll', icon: 'input-touchpad-symbolic'},
    {id: 'mouse-accel', label: 'Mouse acceleration', hint: 'Off: the pointer moves the same distance at any speed', schema: 'org.gnome.desktop.peripherals.mouse', key: 'accel-profile', on: 'default', off: 'flat', icon: 'input-mouse-symbolic'},
    {id: 'tap', label: 'Tap to click', hint: 'Tap the touchpad to click', schema: 'org.gnome.desktop.peripherals.touchpad', key: 'tap-to-click', icon: 'input-touchpad-symbolic'},
    {id: 'focus', label: 'Focus follows mouse', hint: 'A window gets the keyboard when the pointer is over it', schema: 'org.gnome.desktop.wm.preferences', key: 'focus-mode', on: 'sloppy', off: 'click', icon: 'focus-windows-symbolic'},
    {id: 'repeat', label: 'Key repeat', hint: 'Hold a key to repeat it', schema: 'org.gnome.desktop.peripherals.keyboard', key: 'repeat', icon: 'input-keyboard-symbolic'},
];

export class InputWidget extends OsminWidget {
    static id = 'input';
    static title = 'Input';
    static iconName = 'input-mouse-symbolic';

    constructor(context) {
        super(context);
        this._rows = [];
        for (const info of SWITCHES) {
            try {
                this._rows.push({...info, settings: new Gio.Settings({schema_id: info.schema})});
            } catch (e) {
                // that setting does not exist on this system
            }
        }
    }

    _isOn(row) {
        return row.on ? row.settings.get_string(row.key) === row.on : row.settings.get_boolean(row.key);
    }

    _toggle(row) {
        if (row.on)
            row.settings.set_string(row.key, this._isOn(row) ? row.off : row.on);
        else
            row.settings.set_boolean(row.key, !this._isOn(row));
    }

    createView() {
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-widget osmin-input',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._buttons = new Map();
        let line = null;
        this._rows.forEach((row, index) => {
            if (index % 2 === 0) {
                line = new St.BoxLayout({style_class: 'osmin-tools-row', x_expand: true});
                root.add_child(line);
            }
            const button = new St.Button({style_class: 'osmin-input-switch', can_focus: true, x_expand: true, reactive: true, track_hover: true});
            const box = new St.BoxLayout({x_expand: true});
            box.add_child(new St.Icon({icon_name: row.icon, style_class: 'osmin-tool-icon', y_align: Clutter.ActorAlign.CENTER}));
            box.add_child(new St.Label({text: row.label, style_class: 'osmin-input-label', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
            button.set_child(box);
            button.connect('clicked', () => this._toggle(row));
            line.add_child(button);
            this._buttons.set(row.id, button);
            row.settings.connectObject(`changed::${row.key}`, () => this._update(), this);
        });
        this._update();
        return root;
    }

    _update() {
        for (const row of this._rows) {
            const button = this._buttons?.get(row.id);
            if (!button)
                continue;
            if (this._isOn(row))
                button.add_style_pseudo_class('checked');
            else
                button.remove_style_pseudo_class('checked');
        }
    }

    destroy() {
        for (const row of this._rows)
            row.settings.disconnectObject(this);
        super.destroy();
    }
}
