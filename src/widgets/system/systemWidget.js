import St from 'gi://St';

import {formatBytes} from '../../services/systemService.js';
import {EventType, Priority} from '../../utils/events.js';
import {menuCard, menuDivider, menuHeader, menuRow, statTile, statusPill} from '../../ui/menuKit.js';
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

        root.add_child(menuHeader('Temperatures'));
        const temps = menuCard();
        const tiles = new St.BoxLayout({x_expand: true});
        this._temp = statTile('Processor');
        this._load = statTile('Load');
        tiles.add_child(this._temp.actor);
        tiles.add_child(this._load.actor);
        temps.add_child(tiles);
        root.add_child(temps);

        root.add_child(menuHeader('Hardware usage'));
        const usage = menuCard();
        this._cpu = menuRow({title: 'Processor', control: new St.Label({text: '–', style_class: 'osmin-stat-value'})});
        usage.add_child(this._cpu.row);
        this._cpuGraph = this.graphBlock({color: [0.04, 0.52, 1], max: 100});
        this._cpuGraph.scale.text = '100%';
        usage.add_child(this._cpuGraph.actor);
        root.add_child(usage);

        root.add_child(menuHeader('Memory'));
        const memory = menuCard();
        this._pressure = statusPill('Normal');
        this._mem = menuRow({title: 'Memory', subtitle: ' ', control: this._pressure.actor});
        memory.add_child(this._mem.row);
        this._memGraph = this.graphBlock({color: [0.19, 0.82, 0.35], max: 100});
        this._memGraph.scale.text = '100%';
        memory.add_child(this._memGraph.actor);
        memory.add_child(menuDivider());
        this._swap = menuRow({title: 'Swap used', control: new St.Label({text: '–', style_class: 'osmin-stat-value'})});
        memory.add_child(this._swap.row);
        root.add_child(memory);

        this._uptime = new St.Label({text: '', style_class: 'osmin-monitor-note'});
        root.add_child(this._uptime);
        return root;
    }

    _update(s) {
        this._temp.set(s.temp === null ? 'n/a' : `${s.temp}°C`);
        this._load.set(`${s.cpu}%`);
        this._cpu.row.get_first_child().get_last_child().text = `${s.cpu}%`;
        this._cpuGraph.graph.setValues(s.history.cpu);
        const level = s.mem.percent >= 92 ? 'bad' : s.mem.percent >= 80 ? 'warn' : 'good';
        this._pressure.set(level === 'good' ? 'Normal' : level === 'warn' ? 'High' : 'Critical', level);
        this._mem.subtitle.text = `${formatBytes(s.mem.used)} of ${formatBytes(s.mem.total)} (${s.mem.percent}%)`;
        this._memGraph.graph.setValues(s.history.mem);
        this._swap.row.get_first_child().get_last_child().text = `${s.swap}%`;
        this._uptime.text = s.uptime ? `Up for ${formatDuration(s.uptime)}` : '';
    }
}
