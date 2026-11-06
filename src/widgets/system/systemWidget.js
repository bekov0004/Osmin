import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {formatBytes} from '../../services/systemService.js';
import {EventType, Priority} from '../../utils/events.js';
import {bigTile, menuCard, menuDivider, meterRow, sectionLabel, statusPill, valueRow} from '../../ui/menuKit.js';
import {MonitorWidget, formatDuration} from './monitorWidget.js';

/**
 * The computer at a glance: the temperature, the processor and the memory with a graph of the last
 * minutes, and how long it has been on. The numbers come from the Osmin service, which also raises
 * the alerts (a busy processor, heat, a full disk or memory, a low battery); the alerts show as cards.
 */
export class SystemWidget extends MonitorWidget {
    static id = 'system';
    static title = 'System';
    static iconName = 'utilities-system-monitor-symbolic';

    constructor(context) {
        super(context);
        this._events = context.events;
        this._settings = context.settings;
    }

    start() {
        // Only the first capsule's widget starts: the alerts are shown once.
        this._system.connectObject('alert', (_s, alert) => this._onAlert(alert), this);
    }

    _onAlert(alert) {
        if (!this._settings.get('system-alerts'))
            return;
        this._events.emit({
            type: EventType.CUSTOM,
            icon: alert.kind === 'temp' ? 'dialog-warning-symbolic' : alert.kind.startsWith('battery') || alert.kind.startsWith('device') ? 'battery-caution-symbolic' : 'utilities-system-monitor-symbolic',
            title: alert.title,
            description: alert.text,
            priority: Priority.HIGH,
            duration: 6000,
        });
    }

    createPage() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-system osmin-menu-page', x_expand: true});
        const card = menuCard();
        card.add_style_class_name('osmin-bigcard');
        root.add_child(card);

        card.add_child(sectionLabel('Temperatures'));
        const tiles = new St.BoxLayout({style_class: 'osmin-tile-row', x_expand: true});
        this._tempA = bigTile('CPU', 'computer-symbolic');
        this._tempB = bigTile('Disk', 'drive-harddisk-symbolic');
        tiles.add_child(this._tempA.actor);
        tiles.add_child(this._tempB.actor);
        card.add_child(tiles);
        card.add_child(menuDivider());

        const open = new St.Button({style_class: 'osmin-icon-link', reactive: true, can_focus: true, track_hover: true,
            child: new St.Icon({icon_name: 'adw-external-link-symbolic', icon_size: 12})});
        open.connect('clicked', () => this._openMonitor());
        card.add_child(sectionLabel('Hardware usage', open));
        this._cpu = meterRow('CPU', {expandable: true});
        card.add_child(this._cpu.actor);
        this._cpuGraph = this.graphBlock({color: [0.04, 0.52, 1], max: 100});
        this._cpuGraph.scale.text = '100%';
        card.add_child(this._cpuGraph.actor);
        this._gpu = meterRow('GPU', {expandable: false});
        this._gpuGraph = this.graphBlock({color: [0.04, 0.52, 1], max: 100});
        this._gpuGraph.scale.text = '100%';
        this._gpuBox = new St.BoxLayout({vertical: true, x_expand: true, visible: false});
        this._gpuBox.add_child(this._gpu.actor);
        this._gpuBox.add_child(this._gpuGraph.actor);
        card.add_child(this._gpuBox);
        card.add_child(menuDivider());

        card.add_child(sectionLabel('Memory'));
        this._pressure = statusPill('Normal');
        const pressure = new St.BoxLayout({style_class: 'osmin-value-row', x_expand: true});
        pressure.add_child(new St.Label({text: 'Pressure', style_class: 'osmin-value-label', y_align: Clutter.ActorAlign.CENTER}));
        pressure.add_child(this._pressure.actor);
        this._memTotal = new St.Label({text: '', style_class: 'osmin-value-text', x_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        pressure.add_child(this._memTotal);
        card.add_child(pressure);
        this._cached = valueRow('Cached files');
        this._buffers = valueRow('Buffers');
        this._swap = valueRow('Swap used');
        [this._cached, this._buffers, this._swap].forEach(r => {
            r.label.add_style_class_name('osmin-value-indent');
            card.add_child(r.actor);
        });
        this._memGraph = this.graphBlock({color: [0.35, 0.83, 0.98], max: 100});
        this._memGraph.scale.text = '100%';
        card.add_child(this._memGraph.actor);
        card.add_child(menuDivider());

        const up = new St.BoxLayout({style_class: 'osmin-value-row', x_expand: true});
        up.add_child(new St.Icon({icon_name: 'preferences-system-time-symbolic', style_class: 'osmin-meter-icon'}));
        this._uptime = new St.Label({text: '', style_class: 'osmin-value-label', y_align: Clutter.ActorAlign.CENTER});
        up.add_child(this._uptime);
        card.add_child(up);
        return root;
    }

    _openMonitor() {
        const app = Gio.AppInfo.get_all().find(a => /system-monitor|resources|mission-center/i.test(a.get_id() ?? ''));
        app?.launch([], null);
    }

    _update(s) {
        const disk = s.disks?.find(d => d.temp !== null)?.temp ?? null;
        this._tempA.set(s.temp === null ? 'n/a' : `${s.temp} °C`);
        if (s.gpu?.temp != null) {
            this._tempB.actor.get_first_child().get_last_child().text = 'GPU';
            this._tempB.set(`${s.gpu.temp} °C`);
        } else {
            this._tempB.actor.get_first_child().get_last_child().text = 'Disk';
            this._tempB.set(disk === null ? 'n/a' : `${disk} °C`);
        }
        this._cpu.set(s.cpu, s.cpu >= 90);
        this._cpuGraph.graph.setValues(s.history.cpu);
        this._fillApps(s.apps ?? []);
        this._gpuBox.visible = s.gpu?.busy != null;
        if (s.gpu?.busy != null) {
            this._gpu.set(s.gpu.busy, s.gpu.busy >= 90);
            this._gpuHistory = [...(this._gpuHistory ?? []), s.gpu.busy].slice(-60);
            this._gpuGraph.graph.setValues(this._gpuHistory);
        }
        const level = s.mem.percent >= 92 ? 'bad' : s.mem.percent >= 80 ? 'warn' : 'good';
        this._pressure.set(level === 'good' ? 'Normal' : level === 'warn' ? 'High' : 'Critical', level);
        this._memTotal.text = `${formatBytes(s.mem.used)} / ${formatBytes(s.mem.total)}`;
        this._cached.set(formatBytes(Math.max(0, s.mem.cached)));
        this._buffers.set(formatBytes(s.mem.buffers));
        this._swap.set(formatBytes(s.swapBytes?.used ?? 0));
        this._memGraph.graph.setValues(s.history.mem);
        this._uptime.text = s.uptime ? `Up for ${formatDuration(s.uptime)}` : '';
    }

    /** The programs using the processor most, under the CPU line. */
    _fillApps(apps) {
        const key = apps.map(a => `${a.name}:${a.cpu}`).join('|');
        if (key === this._appsKey)
            return;
        this._appsKey = key;
        this._cpu.detail.destroy_all_children();
        apps.forEach(app => {
            const row = valueRow(app.name, `${app.cpu}%`);
            row.label.add_style_class_name('osmin-value-indent');
            this._cpu.detail.add_child(row.actor);
        });
        if (apps.length === 0)
            this._cpu.detail.add_child(new St.Label({text: 'Nothing busy right now.', style_class: 'osmin-monitor-note'}));
    }
}
