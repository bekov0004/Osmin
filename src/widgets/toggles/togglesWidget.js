import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {ToolActions} from '../../tools/toolActions.js';
import {menuCard} from '../../ui/menuKit.js';
import {RowList} from '../../ui/rowList.js';
import {OsminWidget} from '../widget.js';

/**
 * Quick toggles: switches and one-press actions in one list: light or dark mode, the keyboard
 * light, the microphone, the trash, disks, hidden files, the lock and the screen.
 */
export class TogglesWidget extends OsminWidget {
    static id = 'toggles';
    static title = 'Quick toggles';
    static iconName = 'view-list-symbolic';
    static menuNative = true;

    constructor(context) {
        super(context);
        this._actions = new ToolActions(context);
        this._settings = context.settings;
        this._switches = new Map();
        try {
            this._files = new Gio.Settings({schema_id: 'org.gtk.gtk4.Settings.FileChooser'});
        } catch (e) {
            this._files = null;
        }
    }

    get customizable() {
        return true;
    }

    setCustomizing(on) {
        this._list?.setCustomizing(on);
    }

    resetLayout() {
        this._list?.reset();
    }

    _switch(id, getter, setter) {
        return {
            control: () => {
                const toggle = new PopupMenu.Switch(!!getter());
                this._switches.set(id, {toggle, getter});
                return toggle;
            },
            onClick: () => {
                setter(!getter());
                this._sync();
            },
        };
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-toggles osmin-menu-page', x_expand: true});
        const card = menuCard();
        card.add_style_class_name('osmin-bigcard');
        root.add_child(card);
        const a = this._actions;
        const items = [
            {id: 'theme', icon: 'weather-clear-night-symbolic', title: this._actions.dark ? 'Switch to light mode' : 'Switch to dark mode', desc: 'Changes the colour scheme of the whole desktop', onClick: () => {
                a.toggleDark();
                this._list.items.find(i => i.id === 'theme').title = a.dark ? 'Switch to light mode' : 'Switch to dark mode';
                this._list.render();
            }},
            {id: 'night', icon: 'night-light-symbolic', title: 'Night light', desc: 'Warmer colours in the evening', ...this._switch('night', () => a.night, () => a.toggleNight())},
            {id: 'kbdlight', icon: 'keyboard-brightness-symbolic', title: 'Keyboard light', desc: 'Turns the light of the keyboard on or off', ...this._switch('kbd', () => this._kbdOn, on => this._setKbd(on))},
            {id: 'mic', icon: 'microphone-sensitivity-muted-symbolic', title: 'Mute microphone', desc: 'Mutes or unmutes the microphone for every app', onClick: () => a.toggleMic()},
            {id: 'trash', icon: 'user-trash-symbolic', title: 'Empty the Trash', desc: 'Asks twice: the files in it are gone for good', onClick: () => a.emptyTrash(text => {
                const item = this._list.items.find(i => i.id === 'trash');
                item.title = text === 'Empty trash' ? 'Empty the Trash' : 'Sure? Press again';
                this._list.render();
            })},
            {id: 'eject', icon: 'media-eject-symbolic', title: 'Eject all disks', desc: 'Unmounts every USB drive and card', onClick: () => a.ejectAll()},
        ];
        if (this._files)
            items.push({id: 'hidden', icon: 'view-reveal-symbolic', title: 'Show hidden files', subtitle: 'The file manager shows files that start with a dot', desc: 'The file manager shows files that start with a dot',
                ...this._switch('hidden', () => this._files.get_boolean('show-hidden'), on => this._files.set_boolean('show-hidden', on))});
        items.push(
            {id: 'lock', icon: 'system-lock-screen-symbolic', title: 'Lock the screen', desc: 'Locks the session right now', onClick: () => a.lock()},
            {id: 'screenoff', icon: 'video-display-symbolic', title: 'Turn off the display', desc: 'The screen goes dark until you touch the keyboard or the mouse', onClick: () => a.screenOff()},
            {id: 'saver', icon: 'preferences-desktop-screensaver-symbolic', title: 'Start the screen saver', desc: 'Blanks and locks the screen', onClick: () => a.screensaver()});
        this._list = new RowList({page: 'toggles', settings: this._settings, card, items});
        a.watch(this, () => this._sync());
        this._files?.connectObject('changed::show-hidden', () => this._sync(), this);
        return root;
    }

    get _kbdOn() {
        return this._kbdLevel > 0;
    }

    _setKbd(on) {
        try {
            const proxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, 'org.freedesktop.UPower',
                '/org/freedesktop/UPower/KbdBacklight', 'org.freedesktop.UPower.KbdBacklight', null);
            const [max] = proxy.call_sync('GetMaxBrightness', null, Gio.DBusCallFlags.NONE, 500, null).deepUnpack();
            proxy.call_sync('SetBrightness', new GLib.Variant('(i)', [on ? max : 0]), Gio.DBusCallFlags.NONE, 500, null);
            this._kbdLevel = on ? max : 0;
        } catch (e) {
            this._actions.say('dialog-warning-symbolic', 'Keyboard light', 'This keyboard has no light you can control');
        }
    }

    _sync() {
        this._switches.forEach(({toggle, getter}) => (toggle.state = !!getter()));
    }

    onPageShown() {
        this._sync();
    }

    destroy() {
        this._actions.unwatch(this);
        this._files?.disconnectObject(this);
        this._actions.destroy();
        super.destroy();
    }
}
