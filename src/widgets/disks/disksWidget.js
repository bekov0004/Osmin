import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {formatBytes, formatRate, formatTemperature} from '../../services/systemService.js';
import {menuCard, menuDivider, pillButton, sectionLabel, usageBar, valueRow} from '../../ui/menuKit.js';
import {setChecked} from '../../ui/menuKit.js';
import {MonitorWidget} from '../system/monitorWidget.js';

const READ = [0.04, 0.52, 1];
const WRITE = [1, 0.27, 0.38];

/**
 * The disks: pick one, see how full it is, the live reading and writing with a graph, what it
 * has read and written since Osmin started, its temperature, a button to eject the removable ones
 * and shortcuts to open it and to the disk tool.
 */
export class DisksWidget extends MonitorWidget {
    static id = 'disks';
    static title = 'Disks';
    static iconName = 'drive-harddisk-symbolic';

    constructor(context) {
        super(context);
        this._selected = null;
        this._state = null;
    }

    createPage() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-disks osmin-menu-page', x_expand: true});
        const card = menuCard();
        card.add_style_class_name('osmin-bigcard');
        root.add_child(card);

        card.add_child(sectionLabel('Select disk'));
        this._tiles = new St.BoxLayout({vertical: true, style_class: 'osmin-disk-tiles', x_expand: true});
        card.add_child(this._tiles);
        card.add_child(menuDivider());

        const head = new St.BoxLayout({style_class: 'osmin-value-row', x_expand: true});
        head.add_child(new St.Icon({icon_name: 'drive-harddisk-symbolic', style_class: 'osmin-meter-icon', y_align: Clutter.ActorAlign.CENTER}));
        this._name = new St.Label({text: '', style_class: 'osmin-value-label osmin-value-strong', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        head.add_child(this._name);
        this._badges = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER});
        head.add_child(this._badges);
        card.add_child(head);
        this._bar = usageBar();
        this._bar.actor.add_style_class_name('osmin-disk-bar');
        card.add_child(this._bar.actor);
        const used = new St.BoxLayout({style_class: 'osmin-value-row', x_expand: true});
        this._usedText = new St.Label({text: '', style_class: 'osmin-value-label', x_expand: true});
        this._freeText = new St.Label({text: '', style_class: 'osmin-value-label'});
        used.add_child(this._usedText);
        used.add_child(this._freeText);
        card.add_child(used);
        this._sizeText = new St.Label({text: '', style_class: 'osmin-value-muted osmin-value-row'});
        card.add_child(this._sizeText);
        card.add_child(menuDivider());

        card.add_child(sectionLabel('Live activity'));
        const speeds = new St.BoxLayout({style_class: 'osmin-speed-row', x_expand: true});
        this._read = this._speedTile('go-down-symbolic', 'Read', 'osmin-blue');
        this._write = this._speedTile('go-up-symbolic', 'Write', 'osmin-red');
        speeds.add_child(this._read.actor);
        speeds.add_child(new St.Widget({style_class: 'osmin-vline'}));
        speeds.add_child(this._write.actor);
        card.add_child(speeds);
        this._graph = this.graphBlock({color: READ});
        card.add_child(this._graph.actor);
        this._session = valueRow('This session');
        this._session.label.add_style_class_name('osmin-value-muted');
        card.add_child(this._session.actor);
        card.add_child(menuDivider());

        card.add_child(sectionLabel('Details'));
        this._type = valueRow('File system');
        this._temp = valueRow('Temperature');
        this._free = valueRow('Free space');
        this._device = valueRow('Device');
        [this._type, this._temp, this._free, this._device].forEach(r => card.add_child(r.actor));
        card.add_child(menuDivider());

        card.add_child(sectionLabel('External protection'));
        const eject = new St.BoxLayout({style_class: 'osmin-pill-row', x_expand: true});
        this._ejectOne = pillButton({label: 'Eject', icon: 'media-eject-symbolic', onClick: () => this._eject(this._current()?.mount)});
        this._ejectAll = pillButton({label: 'Eject all', icon: 'media-eject-symbolic', onClick: () => this._ejectAllDisks()});
        eject.add_child(this._ejectOne);
        eject.add_child(this._ejectAll);
        card.add_child(eject);
        this._ejectNote = new St.Label({text: '', style_class: 'osmin-value-muted osmin-value-row'});
        card.add_child(this._ejectNote);
        card.add_child(menuDivider());

        card.add_child(sectionLabel('Tools'));
        const tools = new St.BoxLayout({style_class: 'osmin-value-row', x_expand: true});
        this._toolName = new St.Label({text: '', style_class: 'osmin-value-label osmin-value-strong', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        tools.add_child(this._toolName);
        tools.add_child(pillButton({label: 'Open', icon: 'folder-symbolic', onClick: () => this._open()}));
        card.add_child(tools);
        const storage = new St.BoxLayout({style_class: 'osmin-pill-row', x_expand: true});
        storage.add_child(pillButton({label: 'Disks', icon: 'drive-harddisk-symbolic', onClick: () => this._launch(/gnome-disks|baobab|disk-utility/i)}));
        storage.add_child(pillButton({label: 'Storage', icon: 'emblem-system-symbolic', onClick: () => this._launch(/baobab|gnome-control-center|disk-usage/i)}));
        card.add_child(storage);
        return root;
    }

    _speedTile(icon, label, tone) {
        const actor = new St.BoxLayout({style_class: 'osmin-speed', x_expand: true});
        actor.add_child(new St.Label({text: icon === 'go-down-symbolic' ? '↓' : '↑', style_class: `osmin-speed-icon ${tone}`, y_align: Clutter.ActorAlign.START}));
        const texts = new St.BoxLayout({vertical: true});
        const value = new St.Label({text: '–', style_class: 'osmin-speed-value'});
        texts.add_child(value);
        texts.add_child(new St.Label({text: label, style_class: 'osmin-speed-label'}));
        actor.add_child(texts);
        return {actor, set: text => (value.text = text)};
    }

    _current() {
        const disks = this._state?.disks ?? [];
        return disks.find(d => d.mount === this._selected) ?? disks[0] ?? null;
    }

    _update(s) {
        this._state = s;
        this._read.set(formatRate(s.io.read));
        this._write.set(formatRate(s.io.write));
        this._graph.graph.setSeries([{values: s.history.diskRead, color: READ}, {values: s.history.diskWrite, color: WRITE}]);
        this._graph.scale.text = formatRate(this._graph.graph.peak);
        this._session.set(`↓ ${formatBytes(s.totals?.read ?? 0)}  ↑ ${formatBytes(s.totals?.write ?? 0)}`);

        // The tiles are rebuilt only when the list of disks changed, not on every sample.
        const disk = this._current();
        const key = `${s.disks.map(d => `${d.mount}:${d.percent}`).join('|')}#${disk?.mount}`;
        if (key !== this._key) {
            this._key = key;
            this._buildTiles(s.disks, disk);
        }
        if (!disk)
            return;
        this._name.text = disk.name;
        this._badges.destroy_all_children();
        [disk.type.toUpperCase(), disk.removable ? 'External' : 'Internal'].forEach(text =>
            this._badges.add_child(new St.Label({text, style_class: 'osmin-badge', y_align: Clutter.ActorAlign.CENTER})));
        this._bar.set(disk.percent / 100, disk.percent >= 95);
        this._usedText.text = `${disk.percent}% used`;
        this._freeText.text = `${formatBytes(disk.free)} available`;
        this._sizeText.text = `${formatBytes(disk.total - disk.free)} / ${formatBytes(disk.total)}`;
        this._type.set(disk.type);
        this._temp.set(formatTemperature(disk.temp, this.context.settings?.get('temp-unit') ?? 'C'));
        this._free.set(formatBytes(disk.free));
        this._device.set(disk.device);
        this._toolName.text = disk.name;
        const removable = s.disks.filter(d => d.removable);
        this._ejectOne.reactive = disk.removable;
        this._ejectOne.opacity = disk.removable ? 255 : 110;
        this._ejectAll.reactive = removable.length > 0;
        this._ejectAll.opacity = removable.length > 0 ? 255 : 110;
        this._ejectNote.text = removable.length ? '' : 'No external disk ready to eject.';
        this._ejectNote.visible = removable.length === 0;
    }

    _buildTiles(disks, current) {
        this._tiles.destroy_all_children();
        let row = null;
        disks.forEach((disk, i) => {
            if (i % 2 === 0) {
                row = new St.BoxLayout({style_class: 'osmin-chips-row', x_expand: true});
                this._tiles.add_child(row);
            }
            const tile = new St.Button({style_class: 'osmin-disk-tile', x_expand: true, reactive: true, can_focus: true, track_hover: true});
            const box = new St.BoxLayout({x_expand: true});
            box.add_child(new St.Icon({icon_name: disk.removable ? 'media-removable-symbolic' : 'drive-harddisk-symbolic', style_class: 'osmin-meter-icon', y_align: Clutter.ActorAlign.CENTER}));
            const texts = new St.BoxLayout({vertical: true, x_expand: true});
            texts.add_child(new St.Label({text: disk.name, style_class: 'osmin-value-label osmin-value-strong'}));
            texts.add_child(new St.Label({text: `${disk.percent}% used`, style_class: 'osmin-card-subtitle'}));
            box.add_child(texts);
            tile.set_child(box);
            tile.connect('clicked', () => {
                this._selected = disk.mount;
                this._key = null;
                this._update(this._state);
            });
            setChecked(tile, disk.mount === current?.mount);
            row.add_child(tile);
        });
        if (disks.length % 2 === 1)
            row.add_child(new St.Widget({x_expand: true}));
        if (disks.length === 0)
            this._tiles.add_child(new St.Label({text: 'No disks found.', style_class: 'osmin-monitor-note'}));
    }

    _launch(pattern) {
        Gio.AppInfo.get_all().find(a => pattern.test(a.get_id() ?? ''))?.launch([], null);
    }

    _open() {
        const disk = this._current();
        if (disk)
            Gio.AppInfo.launch_default_for_uri(Gio.File.new_for_path(disk.mount).get_uri(), null);
    }

    _ejectAllDisks() {
        (this._state?.disks ?? []).filter(d => d.removable).forEach(d => this._eject(d.mount));
    }

    /** Unmounts and powers off a removable disk, as the file manager does. */
    _eject(path) {
        const mount = Gio.VolumeMonitor.get().get_mounts().find(m => m.get_root()?.get_path() === path);
        if (!mount)
            return;
        const done = (obj, res, method) => {
            try {
                obj[method](res);
            } catch (e) {
                console.warn(`[osmin] eject failed: ${e.message}`);
            }
            this._key = null;
        };
        if (mount.can_eject())
            mount.eject_with_operation(Gio.MountUnmountFlags.NONE, new Gio.MountOperation(), null, (o, r) => done(o, r, 'eject_with_operation_finish'));
        else
            mount.unmount_with_operation(Gio.MountUnmountFlags.NONE, new Gio.MountOperation(), null, (o, r) => done(o, r, 'unmount_with_operation_finish'));
    }
}
