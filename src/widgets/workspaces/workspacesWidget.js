import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {createButton} from '../../ui/button.js';
import {menuCard, menuChip, menuChips, menuDivider, menuHeader, menuRow, setChecked, switchRow} from '../../ui/menuKit.js';
import {targetWindow} from '../../windows/layout.js';
import {MonitorDesktops} from '../../windows/monitorDesktops.js';
import {OsminWidget} from '../widget.js';

/**
 * Desktops (workspaces): the list with a click to switch, a button that makes a new one, one that
 * sends the window you were working in to a new desktop, and the two GNOME settings that decide
 * whether you can keep an empty desktop (dynamic desktops) and whether every monitor switches.
 */
export class WorkspacesWidget extends OsminWidget {
    static id = 'workspaces';
    static title = 'Desktops';
    static iconName = 'view-paged-symbolic';
    static menuNative = true;

    constructor(context) {
        super(context);
        this._mutter = new Gio.Settings({schema_id: 'org.gnome.mutter'});
        this._manager = global.workspace_manager;
        this._target = null;
        this._monitors = null;
        this._monitor = 0;
    }

    get _perMonitor() {
        return !!this.context.settings?.get('desktops-per-monitor');
    }

    start() {
        this.context.settings?.connectObject('changed', (_s, key) => key === 'desktops-per-monitor' && this._syncMode(), this);
        this._syncMode();
    }

    /** Turns the separate desktops of every monitor on or off to match the setting. */
    _syncMode() {
        if (this._perMonitor && !this._monitors) {
            this._monitors = new MonitorDesktops(() => this._rebuild());
            this._monitors.enable();
        } else if (!this._perMonitor && this._monitors) {
            this._monitors.disable();
            this._monitors = null;
        }
        this._perMonitorRow?.set(this._perMonitor);
        if (this._everywhere)
            this._everywhere.row.visible = !this._perMonitor;
        this._rebuild();
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-workspaces osmin-menu-page', x_expand: true});

        this._monitorChips = new St.BoxLayout({vertical: true, x_expand: true});
        root.add_child(this._monitorChips);
        const card = menuCard();
        this._list = new St.BoxLayout({vertical: true, x_expand: true});
        card.add_child(this._list);
        card.add_child(menuDivider());
        const actions = new St.BoxLayout({style_class: 'osmin-chips-row osmin-card-pad', x_expand: true});
        actions.add_child(menuChip({label: 'New desktop', icon: 'list-add-symbolic', primary: true, onClick: () => this._create(false)}));
        actions.add_child(menuChip({label: 'Move window to a new one', icon: 'go-next-symbolic', onClick: () => this._create(true)}));
        card.add_child(actions);
        root.add_child(card);

        root.add_child(menuHeader('Behaviour'));
        const behaviour = menuCard();
        this._dynamic = switchRow({
            title: 'Dynamic desktops',
            subtitle: 'On: an empty desktop is always kept at the end and extra empty ones disappear. Off: the desktops you make stay.',
            onToggle: on => this._mutter.set_boolean('dynamic-workspaces', on),
        });
        behaviour.add_child(this._dynamic.row);
        behaviour.add_child(menuDivider());
        this._perMonitorRow = switchRow({
            title: 'Separate desktops for every monitor',
            subtitle: 'Each monitor has its own desktops: switching on one does not touch the others. Osmin hides the windows of the other desktops.',
            state: this._perMonitor,
            onToggle: on => this.context.settings?.gsettings?.set_boolean('desktops-per-monitor', on),
        });
        behaviour.add_child(this._perMonitorRow.row);
        behaviour.add_child(menuDivider());
        this._everywhere = switchRow({
            title: 'Desktops on every monitor',
            subtitle: 'Off: only the main monitor switches desktops, the others show the same windows.',
            onToggle: on => this._mutter.set_boolean('workspaces-only-on-primary', !on),
        });
        behaviour.add_child(this._everywhere.row);
        root.add_child(behaviour);

        this._manager.connectObject(
            'workspace-added', () => this._rebuild(),
            'workspace-removed', () => this._rebuild(),
            'active-workspace-changed', () => this._rebuild(),
            this);
        this._mutter.connectObject('changed::dynamic-workspaces', () => this._sync(), 'changed::workspaces-only-on-primary', () => this._sync(), this);
        this._sync();
        this._everywhere.row.visible = !this._perMonitor;
        this._rebuild();
        return root;
    }

    onPageShown() {
        // The window that has the focus when the menu opens is the one "move window" sends away.
        this._target = targetWindow();
        // The desktops of the monitor you are working on.
        this._monitor = this._target ? this._target.get_monitor() : global.display.get_current_monitor();
        this._rebuild();
    }

    _sync() {
        this._dynamic?.set(this._mutter.get_boolean('dynamic-workspaces'));
        this._everywhere?.set(!this._mutter.get_boolean('workspaces-only-on-primary'));
    }

    _windowsOn(workspace) {
        return workspace.list_windows().filter(w => w.get_window_type() === Meta.WindowType.NORMAL && !w.is_skip_taskbar() && !w.is_on_all_workspaces());
    }

    _rebuild() {
        if (!this._list)
            return;
        this._list.destroy_all_children();
        this._monitorChips.destroy_all_children();
        if (this._monitors) {
            this._rebuildMonitor();
            return;
        }
        const count = this._manager.get_n_workspaces();
        const active = this._manager.get_active_workspace_index();
        for (let i = 0; i < count; i++) {
            if (i > 0)
                this._list.add_child(menuDivider());
            const workspace = this._manager.get_workspace_by_index(i);
            const n = this._windowsOn(workspace).length;
            const empty = n === 0;
            let control = null;
            if (empty && count > 1) {
                control = createButton({
                    iconName: 'window-close-symbolic', styleClass: 'osmin-ls-file-remove',
                    onClick: () => this._remove(workspace),
                });
            } else if (i === active) {
                control = new St.Icon({icon_name: 'emblem-ok-symbolic', style_class: 'osmin-tool-icon'});
            }
            const {row} = menuRow({
                title: `Desktop ${i + 1}${i === active ? ' (this one)' : ''}`,
                subtitle: empty ? 'Empty' : `${n} window${n === 1 ? '' : 's'}`,
                control,
                onClick: () => workspace.activate(global.get_current_time()),
            });
            setChecked(row, i === active);
            this._list.add_child(row);
        }
    }

    /** The list for one monitor, when every monitor has its own desktops. */
    _rebuildMonitor() {
        const md = this._monitors;
        const monitor = Math.min(this._monitor, md.monitorCount - 1);
        if (md.monitorCount > 1) {
            const primary = global.display.get_primary_monitor();
            const items = Array.from({length: md.monitorCount}, (_v, i) => ({id: String(i), label: i === primary ? `Monitor ${i + 1} (main)` : `Monitor ${i + 1}`}));
            const {actor, buttons} = menuChips(items, id => {
                this._monitor = Number(id);
                this._rebuild();
            }, {perRow: 2});
            buttons.forEach((chip, id) => setChecked(chip, Number(id) === monitor));
            this._monitorChips.add_child(actor);
        }
        const count = md.count(monitor);
        const current = md.current(monitor);
        for (let i = 0; i < count; i++) {
            if (i > 0)
                this._list.add_child(menuDivider());
            const n = md.windowsOn(monitor, i).length;
            const {row} = menuRow({
                title: `Desktop ${i + 1}${i === current ? ' (this one)' : ''}`,
                subtitle: n === 0 ? 'Empty' : `${n} window${n === 1 ? '' : 's'}`,
                control: i === current ? new St.Icon({icon_name: 'emblem-ok-symbolic', style_class: 'osmin-tool-icon'}) : null,
                onClick: () => md.switchTo(monitor, i),
            });
            setChecked(row, i === current);
            this._list.add_child(row);
        }
    }

    /** @param {boolean} withWindow also send the window you were working in to it */
    _create(withWindow) {
        if (this._monitors) {
            const window = withWindow && this._target && !this._target.is_destroyed?.() ? this._target : null;
            const monitor = window ? window.get_monitor() : this._monitor;
            const fresh = this._monitors.count(monitor) - 1;
            if (window)
                this._monitors.moveWindow(window, fresh);
            else
                this._monitors.switchTo(monitor, fresh);
            return;
        }
        const time = global.get_current_time();
        const window = withWindow && this._target && !this._target.is_destroyed?.() ? this._target : null;
        const workspace = this._manager.append_new_workspace(!window, time);
        if (window) {
            window.change_workspace(workspace);
            workspace.activate(time);
        }
        this._rebuild();
    }

    _remove(workspace) {
        if (this._windowsOn(workspace).length > 0 || this._manager.get_n_workspaces() < 2)
            return;
        this._manager.remove_workspace(workspace, global.get_current_time());
        this._rebuild();
    }

    destroy() {
        this.context.settings?.disconnectObject(this);
        this._monitors?.disable();
        this._monitors = null;
        this._manager?.disconnectObject(this);
        this._mutter?.disconnectObject(this);
        this._list = null;
        super.destroy();
    }
}
