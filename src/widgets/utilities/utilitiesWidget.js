import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {ToolActions} from '../../tools/toolActions.js';
import {menuCard, menuDivider} from '../../ui/menuKit.js';
import {RowList} from '../../ui/rowList.js';
import {OsminWidget} from '../widget.js';

/**
 * Utilities: every tool Osmin has in one list of rows, each a click away: screenshot, recording,
 * colour picker, clipboard, window layout, cleaning mode, camera preview, command bar ... In
 * customize mode the rows can be dragged and hidden.
 */
export class UtilitiesWidget extends OsminWidget {
    static id = 'utilities';
    static title = 'Utilities';
    static iconName = 'applications-utilities-symbolic';
    static menuNative = true;

    constructor(context) {
        super(context);
        this._actions = new ToolActions(context);
        this._settings = context.settings;
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

    /** Closes the window, then does `action` (so the window is not in the picture). */
    _after(action) {
        this.context.ui?.closeCapsule?.();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
            action();
            return GLib.SOURCE_REMOVE;
        });
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-utilities osmin-menu-page', x_expand: true});
        const card = menuCard();
        card.add_style_class_name('osmin-bigcard');
        root.add_child(card);
        const ui = this.context.ui;
        const camera = this.context.services.camera;
        const section = name => () => {
            ui?.closeCapsule?.();
            ui?.openSection?.(name);
        };
        const items = [
            {id: 'screenshot', icon: 'applets-screenshooter-symbolic', title: 'Screenshot', desc: 'Capture an area, a window or the whole screen', onClick: () => this._after(() => this._actions.screenshot(0))},
            {id: 'record', icon: 'media-record-symbolic', title: 'Screen recording', desc: 'Record the screen to a video file', onClick: () => this._after(() => this._actions.screenshot(1))},
            {id: 'color', icon: 'color-select-symbolic', title: 'Color picker', desc: 'Pick a colour from anywhere on the screen and copy it', onClick: () => this._actions.pickColor()},
            {id: 'clipboard', icon: 'edit-paste-symbolic', title: 'Clipboard', desc: 'Everything you copied, to reuse later. Stays local and can be cleared any time', onClick: section('clipboard')},
            {id: 'command', icon: 'system-search-symbolic', title: 'Command Bar', desc: 'Search apps, windows and files, calculate, convert and run actions', onClick: section('command')},
            {id: 'tray', icon: 'folder-download-symbolic', title: 'Files tray', desc: 'A shelf for files you are moving between windows', onClick: section('tray')},
            {id: 'layout', icon: 'view-grid-symbolic', title: 'Window layout', desc: 'Arrange windows into screen sections, tile them or move them between monitors', onClick: () => this._openPage('windows')},
            {id: 'desktops', icon: 'view-paged-symbolic', title: 'Desktops', desc: 'Create, switch and remove desktops, also one set per monitor', onClick: () => this._openPage('workspaces')},
            {id: 'cleanurl', icon: 'insert-link-symbolic', title: 'Clean URL', desc: 'Removes tracking parameters from a link the moment it is copied',
                control: () => this._cleanUrlSwitch(), onClick: () => this._toggleCleanUrl()},
            {id: 'cleaning', icon: 'input-keyboard-symbolic', title: 'Cleaning Mode', desc: 'Locks the keyboard and the screen so you can clean them safely', onClick: () => this._actions.cleaningMode()},
            {id: 'camera', icon: 'camera-web-symbolic', title: 'Camera preview', desc: 'A floating mirror to check how you look', onClick: () => this._toggleCamera(camera)},
            {id: 'notes', icon: 'document-edit-symbolic', title: 'Scratchpad', desc: 'Quick notes that stay in the capsule', onClick: section('osmin')},
            {id: 'notifications', icon: 'preferences-system-notifications-symbolic', title: 'Notifications', desc: 'The notifications you have not read yet', onClick: section('notifications')},
        ].filter(Boolean);
        this._list = new RowList({page: 'utilities', settings: this._settings, card: this._cardBox(card), items});
        return root;
    }

    /** The card holds the rows directly. */
    _cardBox(card) {
        return card;
    }

    _openPage(id) {
        if (!this.context.ui?.openPage?.(id))
            this._actions.say('dialog-information-symbolic', 'Turn the tab on', 'Settings → Tools window');
    }

    _cleanUrlSwitch() {
        this._cleanSwitch = new PopupMenu.Switch(!!this._settings?.get('clipboard-clean-urls'));
        return this._cleanSwitch;
    }

    _toggleCleanUrl() {
        const on = !this._settings?.get('clipboard-clean-urls');
        this._settings?.gsettings?.set_boolean('clipboard-clean-urls', on);
        if (this._cleanSwitch)
            this._cleanSwitch.state = on;
    }

    _toggleCamera(camera) {
        if (!camera)
            return;
        this.context.ui?.closeCapsule?.();
        if (camera.state === 'on' || camera.state === 1 || camera.isOn)
            camera.stop();
        else
            camera.start();
    }

    destroy() {
        this._actions.destroy();
        super.destroy();
    }
}
void Gio;
void menuDivider;
