import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {createButton} from '../../ui/button.js';
import {menuCard, menuChip, menuChips, menuDivider, menuHeader, menuRow, setChecked, switchRow} from '../../ui/menuKit.js';
import {targetWindow} from '../../windows/layout.js';
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
        this._monitor = 0;
    }

    /** The separate desktops of every monitor (one for the whole shell, see monitorDesktops.js). */
    get _monitors() {
        return this.context.services?.desktops?.enabled ? this.context.services.desktops : null;
    }

    get _perMonitor() {
        return !!this.context.settings?.get('desktops-per-monitor');
    }

    start() {
        this.context.settings?.connectObject('changed', (_s, key) => key === 'desktops-per-monitor' && this._syncMode(), this);
        this._stopWatching = this.context.services?.desktops?.watch(() => this._rebuild()) ?? null;
        this._syncMode();
    }

    _syncMode() {
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
            subtitle: 'An empty desktop waits at the end; empty ones in between go away.',
            onToggle: on => this._mutter.set_boolean('dynamic-workspaces', on),
        });
        behaviour.add_child(this._dynamic.row);
        behaviour.add_child(menuDivider());
        this._perMonitorRow = switchRow({
            title: 'Separate desktops for every monitor',
            subtitle: 'Each monitor switches on its own. Keys and gestures act on the monitor under the pointer.',
            state: this._perMonitor,
            onToggle: on => this.context.settings?.gsettings?.set_boolean('desktops-per-monitor', on),
        });
        behaviour.add_child(this._perMonitorRow.row);
        behaviour.add_child(menuDivider());
        this._everywhere = switchRow({
            title: 'Desktops only on the main monitor',
            subtitle: 'The other monitors keep showing the same windows.',
            onToggle: on => this._mutter.set_boolean('workspaces-only-on-primary', on),
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
        this._everywhere?.set(this._mutter.get_boolean('workspaces-only-on-primary'));
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
            this._monitorChipsFor(this._shownMonitor());
            if (this._monitors.ownsMonitor(this._shownMonitor())) {
                this._rebuildMonitor();
                return;
            }
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

    _shownMonitor() {
        return Math.max(0, Math.min(this._monitor, Main.layoutManager.monitors.length - 1));
    }

    /** The monitors to choose from, when every monitor has its own desktops. */
    _monitorChipsFor(monitor) {
        const md = this._monitors;
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
    }

    /** The list for a monitor with desktops of its own. */
    _rebuildMonitor() {
        const md = this._monitors;
        const monitor = this._shownMonitor();
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
        const own = withWindow && this._target && !this._target.is_destroyed?.() ? this._target.get_monitor() : this._shownMonitor();
        if (this._monitors?.ownsMonitor(own)) {
            const window = withWindow && this._target && !this._target.is_destroyed?.() ? this._target : null;
            const monitor = own;
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
        this._stopWatching?.();
        this._stopWatching = null;
        this._manager?.disconnectObject(this);
        this._mutter?.disconnectObject(this);
        this._list = null;
        super.destroy();
    }
}
