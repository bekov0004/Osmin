import St from 'gi://St';

import {formatBytes, formatRate} from '../../services/systemService.js';
import {menuCard, menuDivider, menuHeader, menuRow, statTile} from '../../ui/menuKit.js';
import {MonitorWidget} from '../system/monitorWidget.js';

/**
 * The network: how fast data comes in and goes out now, a graph of the last minutes, the
 * connections that are up with this computer's address, and what went through this session.
 */
export class NetworkWidget extends MonitorWidget {
    static id = 'network';
    static title = 'Network';
    static iconName = 'network-wireless-symbolic';

    createPage() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-network osmin-menu-page', x_expand: true});

        root.add_child(menuHeader('Speed'));
        const speed = menuCard();
        const tiles = new St.BoxLayout({x_expand: true});
        this._down = statTile('↓ Download');
        this._up = statTile('↑ Upload');
        this._down.actor.get_last_child().add_style_class_name('osmin-stat-big');
        this._up.actor.get_last_child().add_style_class_name('osmin-stat-big');
        tiles.add_child(this._down.actor);
        tiles.add_child(this._up.actor);
        speed.add_child(tiles);
        this._downGraph = this.graphBlock({color: [0.04, 0.52, 1]});
        this._upGraph = this.graphBlock({color: [0.19, 0.82, 0.35]});
        speed.add_child(this._downGraph.actor);
        speed.add_child(this._upGraph.actor);
        root.add_child(speed);

        root.add_child(menuHeader('Connection'));
        const connection = menuCard();
        this._interfaces = menuRow({title: 'Connected through', control: new St.Label({text: '–', style_class: 'osmin-stat-value'})});
        connection.add_child(this._interfaces.row);
        connection.add_child(menuDivider());
        this._ip = menuRow({title: 'Local address', subtitle: ' '});
        connection.add_child(this._ip.row);
        root.add_child(connection);

        root.add_child(menuHeader('This session'));
        const session = menuCard();
        const totals = new St.BoxLayout({x_expand: true});
        this._downTotal = statTile('↓ Received');
        this._upTotal = statTile('↑ Sent');
        totals.add_child(this._downTotal.actor);
        totals.add_child(this._upTotal.actor);
        session.add_child(totals);
        root.add_child(session);
        return root;
    }

    _update(s) {
        this._down.set(formatRate(s.net.rx));
        this._up.set(formatRate(s.net.tx));
        this._downGraph.graph.setValues(s.history.rx);
        this._upGraph.graph.setValues(s.history.tx);
        this._downGraph.scale.text = `↓ ${formatRate(Math.max(1, ...s.history.rx) * 1.15)}`;
        this._upGraph.scale.text = `↑ ${formatRate(Math.max(1, ...s.history.tx) * 1.15)}`;
        const value = row => row.row.get_first_child().get_last_child();
        value(this._interfaces).text = s.interfaces.length ? s.interfaces.join(', ') : 'Not connected';
        this._ip.subtitle.text = s.ip || '–';
        this._downTotal.set(formatBytes(s.totals?.rx ?? 0));
        this._upTotal.set(formatBytes(s.totals?.tx ?? 0));
    }
}
