import Gio from 'gi://Gio';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {menuCard, pillButton} from '../../ui/menuKit.js';
import {RowList} from '../../ui/rowList.js';
import {OsminWidget} from '../widget.js';

/**
 * Controls: switches for windows, mouse and keyboard, and files, in groups that fold. Each group
 * shows how many of its switches are on ("6/8"). Every switch flips one setting; in customize mode
 * the rows can be dragged and hidden.
 */
export class ControlsWidget extends OsminWidget {
    static id = 'controls';
    static title = 'Controls';
    static iconName = 'preferences-other-symbolic';
    static menuNative = true;

    constructor(context) {
        super(context);
        this._settings = context.settings;
        this._groups = [];
        this._gsettings = [];
        this._switches = new Map();
    }

    get customizable() {
        return true;
    }

    setCustomizing(on) {
        this._groups.forEach(g => g.list.setCustomizing(on));
    }

    resetLayout() {
        this._groups.forEach(g => g.list.reset());
    }

    /** A switch on one GNOME setting (a boolean, or a string with an "on" and an "off" value). */
    _gnome(id, icon, title, desc, schema, key, on = null, off = null, extra = null) {
        let gs;
        try {
            gs = new Gio.Settings({schema_id: schema});
        } catch (e) {
            return null;
        }
        this._gsettings.push({gs, key});
        const getter = () => (on ? gs.get_string(key) === on : gs.get_boolean(key));
        const setter = value => (on ? gs.set_string(key, value ? on : off) : gs.set_boolean(key, value));
        return this._item(id, icon, title, desc, getter, setter, extra);
    }

    _own(id, icon, title, desc, key, extra = null) {
        return this._item(id, icon, title, desc, () => !!this._settings?.get(key), value => this._settings?.gsettings?.set_boolean(key, value), extra);
    }

    _item(id, icon, title, desc, getter, setter, extra = null) {
        return {
            id, icon, title, desc, subtitle: '', getter, extra,
            control: () => {
                const toggle = new PopupMenu.Switch(!!getter());
                this._switches.set(id, {toggle, getter});
                return toggle;
            },
            onClick: () => {
                setter(!getter());
                this._update();
            },
        };
    }

    _openCommand() {
        this.context.ui?.closeCapsule?.();
        this.context.ui?.openSection?.('command');
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-controls osmin-menu-page', x_expand: true});
        const pill = (label, action) => () => pillButton({label, icon: 'go-next-symbolic', onClick: action});

        this._addGroup(root, 'windows', 'Windows', [
            this._gnome('focus', 'focus-windows-symbolic', 'Focus follows mouse', 'A window gets the keyboard when the pointer is over it.', 'org.gnome.desktop.wm.preferences', 'focus-mode', 'sloppy', 'click'),
            this._gnome('dynamic', 'view-paged-symbolic', 'Dynamic desktops', 'An empty desktop is always kept at the end; extra empty ones disappear.', 'org.gnome.mutter', 'dynamic-workspaces'),
            this._own('permonitor', 'view-dual-symbolic', 'Separate desktops for every monitor', 'Switching desktops on one monitor does not switch the others.', 'desktops-per-monitor'),
            this._gnome('edge', 'view-grid-symbolic', 'Snap windows to the screen edges', 'Drag a window to an edge to fill half of the screen.', 'org.gnome.mutter', 'edge-tiling'),
            this._gnome('primary', 'video-display-symbolic', 'Desktops only on the main monitor', 'The other monitors keep showing the same windows.', 'org.gnome.mutter', 'workspaces-only-on-primary'),
            this._gnome('center', 'window-new-symbolic', 'Open new windows in the centre', 'New windows appear in the middle of the screen.', 'org.gnome.mutter', 'center-new-windows'),
            this._gnome('animations', 'applications-graphics-symbolic', 'Animations', 'Windows and menus move smoothly.', 'org.gnome.desktop.interface', 'enable-animations',
                null, null, pill('Window layout', () => this.context.ui?.openPage?.('windows'))),
        ].filter(Boolean));

        this._addGroup(root, 'mouse', 'Mouse and keyboard', [
            this._gnome('mouse-scroll', 'input-mouse-symbolic', 'Invert mouse scrolling', 'Reverses the mouse wheel direction.', 'org.gnome.desktop.peripherals.mouse', 'natural-scroll'),
            this._gnome('mouse-accel', 'input-mouse-symbolic', 'Disable mouse acceleration', 'The pointer moves the same distance at any speed.', 'org.gnome.desktop.peripherals.mouse', 'accel-profile', 'flat', 'default'),
            this._gnome('touchpad-scroll', 'input-touchpad-symbolic', 'Invert touchpad scrolling', 'Natural scrolling for the touchpad.', 'org.gnome.desktop.peripherals.touchpad', 'natural-scroll'),
            this._gnome('tap', 'input-touchpad-symbolic', 'Tap to click', 'Tap the touchpad to click.', 'org.gnome.desktop.peripherals.touchpad', 'tap-to-click'),
            this._gnome('middle', 'input-touchpad-symbolic', 'Three-finger tap acts as middle click', 'A tap with three fingers is a middle click.', 'org.gnome.desktop.peripherals.touchpad', 'tap-button-map', 'lmr', 'lrm'),
            this._gnome('edge-scroll', 'input-touchpad-symbolic', 'Scroll with the edge of the touchpad', 'Slide a finger along the right edge to scroll.', 'org.gnome.desktop.peripherals.touchpad', 'edge-scrolling-enabled'),
            this._gnome('repeat', 'input-keyboard-symbolic', 'Key repeat', 'Hold a key to repeat it.', 'org.gnome.desktop.peripherals.keyboard', 'repeat'),
            this._gnome('togglekeys', 'input-keyboard-symbolic', 'Beep on Caps Lock and Num Lock', 'A sound tells you when a lock key changes.', 'org.gnome.desktop.a11y.keyboard', 'togglekeys-enable',
                null, null, pill('Text snippets', () => this._openCommand())),
        ].filter(Boolean));

        this._addGroup(root, 'files', 'Files', [
            this._own('history', 'edit-paste-symbolic', 'Keep the clipboard history', 'Saved on this computer and restored after a restart.', 'clipboard-keep-history'),
            this._own('cleanurl', 'insert-link-symbolic', 'Clean URLs when copied', 'Removes tracking parameters from a link the moment it is copied.', 'clipboard-clean-urls',
                pill('Open the files tray', () => {
                    this.context.ui?.closeCapsule?.();
                    this.context.ui?.openSection?.('tray');
                })),
        ]);
        this._settings?.connectObject('changed', () => this._update(), this);
        this._gsettings.forEach(({gs, key}) => gs.connectObject(`changed::${key}`, () => this._update(), this));
        this._update();
        return root;
    }

    _addGroup(root, id, title, items) {
        // The header lies outside the card: a chevron, the name in capitals and the count in blue.
        const header = new St.Button({style_class: 'osmin-group-head', reactive: true, can_focus: true, track_hover: true, x_expand: true});
        const line = new St.BoxLayout({x_expand: true});
        const chevron = new St.Icon({icon_name: 'pan-down-symbolic', style_class: 'osmin-meter-chevron'});
        line.add_child(chevron);
        line.add_child(new St.Label({text: title.toUpperCase(), style_class: 'osmin-group-title', x_expand: true}));
        const count = new St.Label({text: '', style_class: 'osmin-collapse-count'});
        line.add_child(count);
        header.set_child(line);
        const card = menuCard();
        card.add_style_class_name('osmin-bigcard');
        header.connect('clicked', () => {
            card.visible = !card.visible;
            chevron.icon_name = card.visible ? 'pan-down-symbolic' : 'pan-end-symbolic';
        });
        root.add_child(header);
        root.add_child(card);
        const list = new RowList({page: `controls-${id}`, settings: this._settings, card, items});
        this._groups.push({list, items, count});
    }

    _update() {
        for (const {items, count} of this._groups) {
            let on = 0;
            for (const item of items) {
                const state = !!item.getter();
                this._switches.get(item.id)?.toggle && (this._switches.get(item.id).toggle.state = state);
                if (state)
                    on++;
            }
            count.text = `${on}/${items.length}`;
        }
    }

    onPageShown() {
        this._update();
    }

    destroy() {
        this._settings?.disconnectObject(this);
        this._gsettings.forEach(({gs}) => gs.disconnectObject(this));
        super.destroy();
    }
}
