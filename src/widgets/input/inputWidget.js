import Gio from 'gi://Gio';
import St from 'gi://St';

import {menuCard, menuDivider, menuHeader, switchRow} from '../../ui/menuKit.js';
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
    static menuNative = true; // laid out with the menu kit: the menu does not wrap it

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
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-input osmin-menu-page', x_expand: true});
        root.add_child(menuHeader('Mouse and touchpad'));
        const pointer = menuCard();
        const keys = menuCard();
        this._switches = new Map();
        const groups = [[pointer, ['mouse-scroll', 'touchpad-scroll', 'mouse-accel', 'tap', 'focus']], [keys, ['repeat']]];
        for (const [card, ids] of groups) {
            ids.map(id => this._rows.find(r => r.id === id)).filter(Boolean).forEach((row, index) => {
                if (index > 0)
                    card.add_child(menuDivider());
                const item = switchRow({title: row.label, subtitle: row.hint, state: this._isOn(row), onToggle: () => this._toggle(row)});
                card.add_child(item.row);
                this._switches.set(row.id, item);
                row.settings.connectObject(`changed::${row.key}`, () => this._update(), this);
            });
        }
        root.add_child(pointer);
        root.add_child(menuHeader('Keyboard'));
        root.add_child(keys);
        return root;
    }

    _update() {
        for (const row of this._rows)
            this._switches?.get(row.id)?.set(this._isOn(row));
    }

    destroy() {
        for (const row of this._rows)
            row.settings.disconnectObject(this);
        super.destroy();
    }
}
