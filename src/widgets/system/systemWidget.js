import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {formatBytes, formatRate} from '../../services/systemService.js';
import {EventType, Priority} from '../../utils/events.js';
import {OsminWidget} from '../widget.js';

/**
 * The computer at a glance: processor, memory, temperature, network, disk and battery, each with a
 * little bar. The numbers come from the Osmin service, which also raises the alerts (a busy
 * processor, heat, a full disk or memory, a low battery); the alerts show as cards.
 */
export class SystemWidget extends OsminWidget {
    static id = 'system';
    static title = 'System';
    static iconName = 'utilities-system-monitor-symbolic';

    constructor(context) {
        super(context);
        this._system = context.services.system;
        this._events = context.events;
        this._settings = context.settings;
        this._cells = new Map();
        this._watching = false;
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

    createView() {
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-widget osmin-system',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const rows = [['cpu', 'CPU'], ['mem', 'RAM'], ['temp', 'Temp'], ['net', 'Network'], ['disk', 'Disk'], ['battery', 'Battery']];
        for (let i = 0; i < rows.length; i += 2) {
            const row = new St.BoxLayout({style_class: 'osmin-system-row', x_expand: true});
            for (const [id, label] of rows.slice(i, i + 2))
                row.add_child(this._createCell(id, label));
            root.add_child(row);
        }
        this._system.connectObject('changed', () => this._update(), this);
        return root;
    }

    _createCell(id, label) {
        const cell = new St.BoxLayout({vertical: true, style_class: 'osmin-system-cell', x_expand: true});
        const head = new St.BoxLayout({x_expand: true});
        head.add_child(new St.Label({text: label, style_class: 'osmin-system-label', x_expand: true}));
        const value = new St.Label({text: '–', style_class: 'osmin-system-value'});
        head.add_child(value);
        cell.add_child(head);
        const track = new St.Widget({style_class: 'osmin-system-bar', x_expand: true, layout_manager: new Clutter.BinLayout()});
        const fill = new St.Widget({style_class: 'osmin-system-fill', x_align: Clutter.ActorAlign.START});
        track.add_child(fill);
        track.connect('notify::width', () => this._update());
        cell.add_child(track);
        this._cells.set(id, {value, track, fill});
        return cell;
    }

    onViewCreated() {
        this._update();
    }

    onPageShown() {
        if (!this._watching) {
            this._watching = true;
            this._system.watch(true);
        }
        this._update();
    }

    onPageHidden() {
        if (this._watching) {
            this._watching = false;
            this._system.watch(false);
        }
    }

    _set(id, text, fraction, warn = false) {
        const cell = this._cells.get(id);
        if (!cell)
            return;
        cell.value.text = text;
        if (warn)
            cell.fill.add_style_pseudo_class('warn');
        else
            cell.fill.remove_style_pseudo_class('warn');
        const width = cell.track.mapped ? cell.track.width : 0;
        cell.fill.set_width(Math.round(width * Math.min(Math.max(fraction, 0), 1)));
    }

    _update() {
        if (!this._view)
            return;
        const s = this._system.state;
        if (s.cpu === undefined)
            return;
        this._set('cpu', `${s.cpu}%`, s.cpu / 100, s.cpu >= 90);
        this._set('mem', `${formatBytes(s.mem.used)}`, s.mem.percent / 100, s.mem.percent >= 92);
        this._set('temp', s.temp === null ? 'n/a' : `${s.temp}°C`, s.temp === null ? 0 : s.temp / 100, s.temp !== null && s.temp >= 85);
        const net = Math.max(s.net.rx, s.net.tx);
        this._set('net', `↓${formatRate(s.net.rx)} ↑${formatRate(s.net.tx)}`, Math.min(1, Math.log10(1 + net / 1024) / 4));
        this._set('disk', `${formatBytes(s.disk.free)} free`, s.disk.percent / 100, s.disk.percent >= 95);
        if (s.battery)
            this._set('battery', `${s.battery.percent}%${s.battery.charging ? ' ⚡' : ''}`, s.battery.percent / 100, !s.battery.charging && s.battery.percent <= 20);
        else
            this._set('battery', 'no battery', 0);
    }

    destroy() {
        this._system.disconnectObject(this);
        this.onPageHidden();
        super.destroy();
    }
}
