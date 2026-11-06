import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {formatTemperature} from '../../services/systemService.js';
import {menuCard, menuDivider, meterRow, valueRow} from '../../ui/menuKit.js';
import {MonitorWidget, formatDuration} from '../system/monitorWidget.js';

/**
 * The battery: the charge with its history, the programs that keep the processor busy (and so use
 * the energy), the heat, the power the computer draws, the adapter and the health of the battery.
 */
export class PowerWidget extends MonitorWidget {
    static id = 'power';
    static title = 'Power';
    static iconName = 'battery-full-symbolic';

    createPage() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-power osmin-menu-page', x_expand: true});
        this._none = new St.Label({text: 'There is no battery in this computer.', style_class: 'osmin-monitor-note'});
        root.add_child(this._none);

        this._card = menuCard();
        this._card.add_style_class_name('osmin-bigcard');
        root.add_child(this._card);
        const card = this._card;

        this._battery = meterRow('Battery', {icon: 'battery-symbolic'});
        this._battery.actor.add_style_class_name('osmin-meter-green');
        card.add_child(this._battery.actor);
        this._chargeGraph = this.graphBlock({color: [0.19, 0.82, 0.35], max: 100});
        this._chargeGraph.scale.text = '100%';
        card.add_child(this._chargeGraph.actor);
        card.add_child(menuDivider());

        this._apps = meterRow('Apps using the processor', {expandable: true});
        // This one is only a heading with a list: no bar and no percent.
        const line = this._apps.actor.get_first_child();
        line.get_children().slice(1).forEach(c => c.hide());
        card.add_child(this._apps.actor);
        card.add_child(menuDivider());

        this._temp = this._iconRow('Battery temperature', 'utilities-system-monitor-symbolic');
        card.add_child(this._temp.actor);
        card.add_child(menuDivider());

        this._drawRow = this._iconRow('System', 'weather-storm-symbolic');
        card.add_child(this._drawRow.actor);
        this._wattGraph = this.graphBlock({color: [1, 0.62, 0.04]});
        card.add_child(this._wattGraph.actor);
        card.add_child(menuDivider());

        this._adapter = this._iconRow('Adapter', 'ac-adapter-symbolic', ' ');
        card.add_child(this._adapter.actor);
        card.add_child(menuDivider());
        this._charging = this._iconRow('Battery', 'battery-good-charging-symbolic', ' ');
        card.add_child(this._charging.actor);
        card.add_child(menuDivider());
        this._health = this._iconRow('Battery health', 'emblem-favorite-symbolic', ' ');
        card.add_child(this._health.actor);

        this._devicesBox = new St.BoxLayout({vertical: true, x_expand: true});
        card.add_child(this._devicesBox);
        return root;
    }

    /** A row with an icon, a title (and a muted line under it) and a value on the right. */
    _iconRow(title, icon, subtitle = '') {
        const actor = new St.BoxLayout({style_class: 'osmin-icon-row', x_expand: true});
        actor.add_child(new St.Icon({icon_name: icon, style_class: 'osmin-meter-icon', y_align: Clutter.ActorAlign.CENTER}));
        const texts = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const name = new St.Label({text: title, style_class: 'osmin-value-label'});
        texts.add_child(name);
        let sub = null;
        if (subtitle) {
            sub = new St.Label({text: subtitle, style_class: 'osmin-card-subtitle'});
            texts.add_child(sub);
        }
        actor.add_child(texts);
        const value = new St.Label({text: '–', style_class: 'osmin-value-text osmin-value-strong', y_align: Clutter.ActorAlign.CENTER});
        actor.add_child(value);
        return {actor, set: (text, subText = null) => {
            value.text = text;
            if (sub && subText !== null)
                sub.text = subText;
        }};
    }

    _update(s) {
        const has = !!s.battery;
        this._none.visible = !has;
        this._card.visible = has;
        if (!has)
            return;
        const {battery, power} = s;
        const low = !battery.charging && battery.percent <= 20;
        this._battery.set(battery.percent, low);
        const left = power?.minutes ? `  ·  ${formatDuration(power.minutes * 60)} ${battery.charging ? 'to full' : 'left'}` : '';
        this._battery.setLabel(`Battery${left}`);
        this._chargeGraph.graph.setValues(s.history.bat);
        this._fillApps(s.apps ?? []);
        this._temp.set(power?.temp ? formatTemperature(power.temp, this.context.settings?.get('temp-unit') ?? 'C') : 'n/a');
        this._drawRow.set(power ? `${power.watts} W` : '–');
        this._wattGraph.graph.setValues(s.history.watts);
        this._wattGraph.scale.text = `${Math.max(1, Math.ceil(this._wattGraph.graph.peak))} W`;
        this._adapter.set(power?.mains ? 'Plugged in' : 'Not plugged in', 'Power source');
        this._charging.set(power ? `${power.watts} W` : '–', battery.status === 'Full' ? 'Full' : battery.charging ? 'Charging' : 'Discharging');
        this._health.set(power?.health ? `${power.health}%` : 'n/a', power?.cycles ? `${power.cycles} Cycles` : 'Capacity');

        this._devicesBox.destroy_all_children();
        s.devices?.forEach(device => {
            this._devicesBox.add_child(menuDivider());
            const row = valueRow(device.name, `${device.percent}%`);
            this._devicesBox.add_child(row.actor);
        });
    }

    _fillApps(apps) {
        const key = apps.map(a => `${a.name}:${a.cpu}`).join('|');
        if (key === this._appsKey)
            return;
        this._appsKey = key;
        this._apps.detail.destroy_all_children();
        const total = apps.reduce((a, b) => a + b.cpu, 0) || 1;
        apps.forEach(app => {
            const row = valueRow(app.name, `${Math.round(100 * app.cpu / total * 10) / 10}%`);
            row.label.add_style_class_name('osmin-value-indent');
            this._apps.detail.add_child(row.actor);
        });
        if (apps.length === 0)
            this._apps.detail.add_child(new St.Label({text: 'Nothing is using much right now.', style_class: 'osmin-monitor-note'}));
    }
}
