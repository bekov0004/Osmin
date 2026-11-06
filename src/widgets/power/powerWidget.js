import St from 'gi://St';

import {menuCard, menuDivider, menuHeader, menuRow, statTile, statusPill, usageBar} from '../../ui/menuKit.js';
import {MonitorWidget, formatDuration} from '../system/monitorWidget.js';

/**
 * The battery: the charge with its history, the power the computer draws, the adapter, the health
 * of the battery and the batteries of connected devices (keyboard, mouse, headset).
 */
export class PowerWidget extends MonitorWidget {
    static id = 'power';
    static title = 'Power';
    static iconName = 'battery-full-symbolic';

    createPage() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-power osmin-menu-page', x_expand: true});

        this._none = new St.Label({text: 'There is no battery in this computer.', style_class: 'osmin-monitor-note'});
        root.add_child(this._none);

        this._battery = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'osmin-menu-page'});
        this._battery.add_child(menuHeader('Battery'));
        const card = menuCard();
        this._state = statusPill('Charging');
        this._charge = menuRow({title: '–', subtitle: ' ', control: this._state.actor});
        card.add_child(this._charge.row);
        this._bar = usageBar();
        this._bar.actor.add_style_class_name('osmin-disk-bar');
        card.add_child(this._bar.actor);
        this._chargeGraph = this.graphBlock({color: [0.19, 0.82, 0.35], max: 100});
        this._chargeGraph.scale.text = '100%';
        card.add_child(this._chargeGraph.actor);
        this._battery.add_child(card);

        this._battery.add_child(menuHeader('Power'));
        const power = menuCard();
        const tiles = new St.BoxLayout({x_expand: true});
        this._watts = statTile('Draw');
        this._source = statTile('Source');
        tiles.add_child(this._watts.actor);
        tiles.add_child(this._source.actor);
        power.add_child(tiles);
        this._wattGraph = this.graphBlock({color: [1, 0.62, 0.04]});
        power.add_child(this._wattGraph.actor);
        this._battery.add_child(power);

        this._battery.add_child(menuHeader('Battery health'));
        const health = menuCard();
        const stats = new St.BoxLayout({x_expand: true});
        this._health = statTile('Capacity');
        this._cycles = statTile('Cycles');
        this._temp = statTile('Temperature');
        stats.add_child(this._health.actor);
        stats.add_child(this._cycles.actor);
        stats.add_child(this._temp.actor);
        health.add_child(stats);
        this._battery.add_child(health);
        root.add_child(this._battery);

        this._devicesBox = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'osmin-menu-page'});
        root.add_child(this._devicesBox);
        return root;
    }

    _update(s) {
        const has = !!s.battery;
        this._none.visible = !has;
        this._battery.visible = has;
        if (has) {
            const {battery, power} = s;
            this._charge.title.text = `${battery.percent}%`;
            const left = power?.minutes ? `${formatDuration(power.minutes * 60)} ${battery.charging ? 'to full' : 'left'}` : '';
            this._charge.subtitle.text = left || (battery.status || ' ');
            const low = !battery.charging && battery.percent <= 20;
            this._state.set(battery.status === 'Full' ? 'Full' : battery.charging ? 'Charging' : 'On battery', low ? 'bad' : battery.charging ? 'good' : 'warn');
            this._bar.set(battery.percent / 100, low);
            this._chargeGraph.graph.setValues(s.history.bat);
            this._watts.set(power ? `${power.watts} W` : '–');
            this._source.set(power?.mains ? 'Adapter' : 'Battery');
            this._wattGraph.graph.setValues(s.history.watts);
            this._wattGraph.scale.text = `${Math.max(1, ...s.history.watts).toFixed(0)} W`;
            this._health.set(power?.health ? `${power.health}%` : 'n/a');
            this._cycles.set(power?.cycles ? `${power.cycles}` : 'n/a');
            this._temp.set(power?.temp ? `${power.temp}°C` : 'n/a');
        }
        this._devicesBox.destroy_all_children();
        if (s.devices?.length) {
            this._devicesBox.add_child(menuHeader('Connected devices'));
            const card = menuCard();
            s.devices.forEach((device, i) => {
                if (i > 0)
                    card.add_child(menuDivider());
                card.add_child(menuRow({title: device.name, control: new St.Label({text: `${device.percent}%`, style_class: 'osmin-stat-value'})}).row);
            });
            this._devicesBox.add_child(card);
        }
    }
}
