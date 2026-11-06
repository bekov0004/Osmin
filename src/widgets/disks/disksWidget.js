import Gio from 'gi://Gio';
import St from 'gi://St';

import {formatBytes, formatRate} from '../../services/systemService.js';
import {createButton} from '../../ui/button.js';
import {menuCard, menuDivider, menuHeader, menuRow, statTile, usageBar} from '../../ui/menuKit.js';
import {MonitorWidget} from '../system/monitorWidget.js';

/**
 * The disks: every mounted disk with how full it is and a button to eject the removable ones, and
 * the live reading and writing with a graph.
 */
export class DisksWidget extends MonitorWidget {
    static id = 'disks';
    static title = 'Disks';
    static iconName = 'drive-harddisk-symbolic';

    createPage() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-disks osmin-menu-page', x_expand: true});

        root.add_child(menuHeader('Disks'));
        this._list = new St.BoxLayout({vertical: true, x_expand: true});
        root.add_child(this._list);

        root.add_child(menuHeader('Live activity'));
        const live = menuCard();
        const tiles = new St.BoxLayout({x_expand: true});
        this._read = statTile('Read');
        this._write = statTile('Write');
        tiles.add_child(this._read.actor);
        tiles.add_child(this._write.actor);
        live.add_child(tiles);
        this._readGraph = this.graphBlock({color: [0.04, 0.52, 1]});
        this._writeGraph = this.graphBlock({color: [1, 0.62, 0.04]});
        live.add_child(this._readGraph.actor);
        live.add_child(this._writeGraph.actor);
        root.add_child(live);
        return root;
    }

    _update(s) {
        this._read.set(formatRate(s.io.read));
        this._write.set(formatRate(s.io.write));
        this._readGraph.graph.setValues(s.history.diskRead);
        this._writeGraph.graph.setValues(s.history.diskWrite);
        this._readGraph.scale.text = `Read ${formatRate(Math.max(1, ...s.history.diskRead) * 1.15)}`;
        this._writeGraph.scale.text = `Write ${formatRate(Math.max(1, ...s.history.diskWrite) * 1.15)}`;

        // Rebuild the list only when the disks themselves changed, not on every sample.
        const key = s.disks.map(d => `${d.device}:${d.percent}`).join('|');
        if (key === this._key)
            return;
        this._key = key;
        this._list.destroy_all_children();
        const card = menuCard();
        s.disks.forEach((disk, i) => {
            if (i > 0)
                card.add_child(menuDivider());
            let control = new St.Label({text: `${disk.percent}%`, style_class: 'osmin-stat-value'});
            if (disk.removable) {
                control = createButton({iconName: 'media-eject-symbolic', styleClass: 'osmin-ls-file-remove', onClick: () => this._eject(disk.mount)});
            }
            card.add_child(menuRow({
                title: disk.name,
                subtitle: `${formatBytes(disk.total - disk.free)} used of ${formatBytes(disk.total)} · ${formatBytes(disk.free)} free`,
                control,
            }).row);
            const bar = usageBar();
            bar.actor.add_style_class_name('osmin-disk-bar');
            bar.set(disk.percent / 100, disk.percent >= 95);
            card.add_child(bar.actor);
        });
        if (s.disks.length === 0)
            card.add_child(new St.Label({text: 'No disks found.', style_class: 'osmin-monitor-note'}));
        this._list.add_child(card);
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
