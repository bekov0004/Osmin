import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {formatBytes, formatRate} from '../../services/systemService.js';
import {menuCard, menuDivider, pillButton, sectionLabel, valueRow} from '../../ui/menuKit.js';
import {MonitorWidget} from '../system/monitorWidget.js';

const DOWN = [0.04, 0.52, 1];
const UP = [0.19, 0.82, 0.35];

/**
 * The network: how fast data comes in and goes out now with one graph of both, what went through
 * this session, the address of this computer and a button for a speed test.
 */
export class NetworkWidget extends MonitorWidget {
    static id = 'network';
    static title = 'Network';
    static iconName = 'network-wireless-symbolic';

    createPage() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-network osmin-menu-page', x_expand: true});
        const card = menuCard();
        card.add_style_class_name('osmin-bigcard');
        root.add_child(card);

        const speeds = new St.BoxLayout({style_class: 'osmin-speed-row', x_expand: true});
        this._down = this._speedTile('go-down-symbolic', 'Download', 'osmin-blue');
        this._up = this._speedTile('go-up-symbolic', 'Upload', 'osmin-green');
        speeds.add_child(this._down.actor);
        speeds.add_child(new St.Widget({style_class: 'osmin-vline'}));
        speeds.add_child(this._up.actor);
        card.add_child(speeds);

        this._graph = this.graphBlock({color: DOWN});
        card.add_child(this._graph.actor);
        card.add_child(menuDivider());

        this._interfaces = valueRow('Connected through');
        card.add_child(this._interfaces.actor);
        card.add_child(menuDivider());
        this._session = valueRow('This session');
        this._session.label.add_style_class_name('osmin-value-muted');
        card.add_child(this._session.actor);
        card.add_child(menuDivider());
        this._ip = valueRow('Local IPv4');
        this._ip.label.add_style_class_name('osmin-value-muted');
        card.add_child(this._ip.actor);
        card.add_child(menuDivider());
        const actions = new St.BoxLayout({style_class: 'osmin-value-row', x_expand: true});
        actions.add_child(pillButton({label: 'Speed test', icon: 'speedometer-symbolic', onClick: () => Gio.AppInfo.launch_default_for_uri('https://fast.com', null)}));
        card.add_child(actions);
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

    _update(s) {
        this._down.set(formatRate(s.net.rx));
        this._up.set(formatRate(s.net.tx));
        this._graph.graph.setSeries([{values: s.history.rx, color: DOWN}, {values: s.history.tx, color: UP}]);
        this._graph.scale.text = formatRate(this._graph.graph.peak);
        this._interfaces.set(s.interfaces.length ? s.interfaces.join(', ') : 'Not connected');
        this._session.set(`↓${formatBytes(s.totals?.rx ?? 0)}  ↑${formatBytes(s.totals?.tx ?? 0)}`);
        this._ip.set(s.ip || '–');
    }
}
