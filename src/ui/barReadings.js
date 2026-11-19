import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {formatBytes, formatRate, formatTemperature} from '../services/systemService.js';
import {formatDuration} from '../widgets/system/monitorWidget.js';
import {menuDivider, valueRow} from './menuKit.js';
import {Sparkline} from './sparkline.js';

const WIDTH = 290;
const BLUE = [0.04, 0.52, 1];
const CYAN = [0.35, 0.83, 0.98];
const GREEN = [0.19, 0.82, 0.35];
const ORANGE = [1, 0.62, 0.04];

const short = v => formatRate(v).replace(' B/s', 'B').replace(' KB/s', 'K').replace(' MB/s', 'M');

/**
 * What each reading is: its short form in the top bar, and what its window tells.
 * detail(state, unit) -> {value, sub, graph?: {series: [{values, color}], max, label}, rows: [[label, value]], page}
 */
const READINGS = {
    cpu: {
        label: 'CPU', title: 'Processor', icon: 'utilities-system-monitor-symbolic',
        bar: s => `${s.cpu}%`,
        detail: (s, unit) => ({
            value: `${s.cpu}%`, sub: 'in use',
            graph: {series: [{values: s.history?.cpu ?? [], color: BLUE}], max: 100, label: '100%'},
            rows: [
                s.temp != null && ['Temperature', formatTemperature(s.temp, unit)],
                s.uptime && ['Up for', formatDuration(s.uptime)],
                ...topApps(s),
            ],
            page: 'system',
        }),
    },
    cputemp: {
        label: 'TMP', title: 'Temperature', icon: 'weather-clear-symbolic',
        bar: s => (s.temp == null ? null : `${s.temp}°`),
        detail: (s, unit) => ({
            value: formatTemperature(s.temp, unit), sub: 'processor',
            rows: [
                s.gpu?.temp != null && ['Graphics', formatTemperature(s.gpu.temp, unit)],
                ...(s.disks ?? []).filter(d => d.temp != null).map(d => [d.name, formatTemperature(d.temp, unit)]),
                s.power?.temp && ['Battery', formatTemperature(s.power.temp, unit)],
                ['Processor in use', `${s.cpu}%`],
            ],
            page: 'system',
        }),
    },
    gpu: {
        label: 'GPU', title: 'Graphics', icon: 'video-display-symbolic',
        bar: s => (s.gpu?.busy == null ? null : `${s.gpu.busy}%`),
        detail: (s, unit) => ({
            value: `${s.gpu?.busy ?? 0}%`, sub: 'in use',
            rows: [s.gpu?.temp != null && ['Temperature', formatTemperature(s.gpu.temp, unit)]],
            page: 'system',
        }),
    },
    mem: {
        label: 'RAM', title: 'Memory', icon: 'drive-multidisk-symbolic',
        bar: s => `${s.mem?.percent}%`,
        detail: s => ({
            value: `${s.mem?.percent ?? 0}%`, sub: `${formatBytes(s.mem?.used ?? 0)} of ${formatBytes(s.mem?.total ?? 0)}`,
            graph: {series: [{values: s.history?.mem ?? [], color: CYAN}], max: 100, label: '100%'},
            rows: [
                s.mem?.cached != null && ['Cached files', formatBytes(Math.max(0, s.mem.cached))],
                s.mem?.buffers != null && ['Buffers', formatBytes(s.mem.buffers)],
                s.swapBytes?.total > 0 && ['Swap used', `${formatBytes(s.swapBytes.used)} of ${formatBytes(s.swapBytes.total)}`],
            ],
            page: 'system',
        }),
    },
    battery: {
        label: 'BAT', title: 'Battery', icon: 'battery-symbolic',
        bar: s => (s.battery ? `${s.battery.percent}%` : null),
        detail: s => ({
            value: `${s.battery?.percent ?? 0}%`,
            sub: s.battery?.status === 'Full' ? 'full' : s.battery?.charging ? 'charging' : 'on battery',
            graph: {series: [{values: s.history?.bat ?? [], color: GREEN}], max: 100, label: '100%'},
            rows: [
                s.power?.minutes && [s.battery?.charging ? 'Full in' : 'Left', formatDuration(s.power.minutes * 60)],
                s.power && ['Power', `${s.power.watts} W`],
                s.power && ['Adapter', s.power.mains ? 'Plugged in' : 'Not plugged in'],
                s.power?.health && ['Health', `${s.power.health}%`],
            ],
            page: 'power',
        }),
    },
    net: {
        label: 'NET', title: 'Network', icon: 'network-wireless-symbolic',
        bar: s => `↓${short(s.net?.rx ?? 0)} ↑${short(s.net?.tx ?? 0)}`,
        detail: s => ({
            value: `↓ ${formatRate(s.net?.rx ?? 0)}`, sub: `↑ ${formatRate(s.net?.tx ?? 0)}`,
            graph: {series: [{values: s.history?.rx ?? [], color: BLUE}, {values: s.history?.tx ?? [], color: GREEN}], max: null},
            rows: [
                ['Connected through', s.interfaces?.length ? s.interfaces.join(', ') : 'Not connected'],
                s.ip && ['Local address', s.ip],
                ['This session', `↓${formatBytes(s.totals?.rx ?? 0)}  ↑${formatBytes(s.totals?.tx ?? 0)}`],
            ],
            page: 'network',
        }),
    },
    disk: {
        label: 'DSK', title: 'Disk', icon: 'drive-harddisk-symbolic',
        bar: s => `${s.disk?.percent}%`,
        detail: s => ({
            value: `${s.disk?.percent ?? 0}%`, sub: 'used',
            rows: [
                ['Free', formatBytes(s.disk?.free ?? 0)],
                ['Size', formatBytes(s.disk?.total ?? 0)],
                ...(s.disks ?? []).filter(d => d.name).slice(0, 4).map(d => [d.name, `${d.percent}% · ${formatBytes(d.free)} free`]),
            ],
            page: 'disks',
        }),
    },
    diskio: {
        label: 'I/O', title: 'Disk activity', icon: 'drive-harddisk-symbolic',
        bar: s => `R${short(s.io?.read ?? 0)} W${short(s.io?.write ?? 0)}`,
        detail: s => ({
            value: `R ${formatRate(s.io?.read ?? 0)}`, sub: `W ${formatRate(s.io?.write ?? 0)}`,
            graph: {series: [{values: s.history?.diskRead ?? [], color: BLUE}, {values: s.history?.diskWrite ?? [], color: ORANGE}], max: null},
            rows: [['This session', `read ${formatBytes(s.totals?.read ?? 0)} · written ${formatBytes(s.totals?.write ?? 0)}`]],
            page: 'disks',
        }),
    },
    power: {
        label: 'PWR', title: 'Power use', icon: 'battery-full-charging-symbolic',
        bar: s => (s.power ? `${s.power.watts}W` : null),
        detail: s => ({
            value: `${s.power?.watts ?? 0} W`, sub: s.power?.mains ? 'plugged in' : 'on battery',
            graph: {series: [{values: s.history?.watts ?? [], color: ORANGE}], max: null},
            rows: [
                s.battery && ['Battery', `${s.battery.percent}%`],
                s.power?.minutes && [s.battery?.charging ? 'Full in' : 'Left', formatDuration(s.power.minutes * 60)],
            ],
            page: 'power',
        }),
    },
};

/** The busiest apps, for the processor's window. */
function topApps(s) {
    const apps = [...(s.apps ?? [])].sort((a, b) => b.cpu - a.cpu).slice(0, 3).filter(a => a.cpu > 0);
    return apps.map((a, i) => [i === 0 ? `Busiest: ${a.name}` : a.name, `${a.cpu}%`]);
}

/**
 * The readings written in the top bar beside the Osmin button (CPU, temperature, memory ...): each one an item of its
 * own that lights on its own, and opens a small window under it with more about it (a graph of the last minutes, the
 * numbers behind it, a button to the full page in the quick panel).
 */
export class BarReadings {
    /**
     * @param {{anchor: () => Clutter.Actor|null, openPage: (id: string) => void, unit: () => string}} options anchor: the
     *   top-bar item they come after
     */
    constructor({anchor, openPage, unit}) {
        this._anchor = anchor;
        this._openPage = openPage;
        this._unit = unit;
        this._items = new Map();    // id -> {button, label, body, render}
        this._state = null;
    }

    /** Shows the readings with these ids (in this order) with the numbers of `state` (null: none). */
    sync(state, ids) {
        this._state = state;
        const shown = state ? ids.filter(id => READINGS[id] && READINGS[id].bar(state) != null) : [];
        for (const [id, item] of this._items) {
            if (!shown.includes(id)) {
                item.button.destroy();
                this._items.delete(id);
            }
        }
        let previous = this._anchor()?.container ?? null;
        for (const id of shown) {
            let item = this._items.get(id);
            if (!item) {
                item = this._create(id);
                this._items.set(id, item);
            }
            const parent = previous?.get_parent();
            if (parent && item.button.container.get_parent() !== parent) {
                item.button.container.get_parent()?.remove_child(item.button.container);
                parent.insert_child_above(item.button.container, previous);
            } else if (parent) {
                parent.set_child_above_sibling(item.button.container, previous);
            }
            previous = item.button.container;
            const reading = READINGS[id];
            const esc = text => GLib.markup_escape_text(String(text), -1);
            item.label.clutter_text.set_markup(`<span size="x-small" alpha="60%">${esc(reading.label)}</span> <b>${esc(reading.bar(state))}</b>`);
            if (item.button.menu.isOpen)
                item.render();
        }
    }

    _create(id) {
        const reading = READINGS[id];
        const button = new PanelMenu.Button(0.5, `Osmin ${reading.title}`, false);
        button.add_style_class_name('osmin-reading-button');
        const label = new St.Label({style_class: 'osmin-bar-readings', y_align: Clutter.ActorAlign.CENTER});
        button.add_child(label);
        button.menu.actor.add_style_class_name('osmin-menu');
        button.menu.actor.add_style_class_name('osmin-reading-menu');
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, activate: false});
        item.add_style_class_name('osmin-menu-item');
        const body = new St.BoxLayout({vertical: true, style_class: 'osmin-reading-root', width: WIDTH});
        item.add_child(body);
        button.menu.addMenuItem(item);
        // Not added with addToStatusArea: these are placed beside the Osmin button by sync(); the panel still has
        // to know about their menus (to open and close them as its own).
        Main.panel.menuManager.addMenu(button.menu);
        const entry = {button, label, body, render: () => this._render(id, body)};
        button.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                entry.render();
        });
        return entry;
    }

    _render(id, body) {
        const state = this._state;
        if (!state)
            return;
        const reading = READINGS[id];
        const detail = reading.detail(state, this._unit());
        body.destroy_all_children();

        const head = new St.BoxLayout({style_class: 'osmin-reading-head', x_expand: true});
        head.add_child(new St.Icon({icon_name: reading.icon, style_class: 'osmin-reading-icon', y_align: Clutter.ActorAlign.CENTER}));
        const titles = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        titles.add_child(new St.Label({text: reading.title.toUpperCase(), style_class: 'osmin-reading-title'}));
        const big = new St.BoxLayout({style_class: 'osmin-reading-big-line'});
        big.add_child(new St.Label({text: detail.value, style_class: 'osmin-reading-value', y_align: Clutter.ActorAlign.END}));
        if (detail.sub)
            big.add_child(new St.Label({text: detail.sub, style_class: 'osmin-reading-sub', y_align: Clutter.ActorAlign.END}));
        titles.add_child(big);
        head.add_child(titles);
        body.add_child(head);

        const card = new St.BoxLayout({vertical: true, style_class: 'osmin-card osmin-reading-card', x_expand: true});
        if (detail.graph) {
            const graph = new Sparkline({color: detail.graph.series[0].color, max: detail.graph.max, height: 56,
                label: detail.graph.max ? null : max => formatRate(max)});
            if (detail.graph.series.length > 1)
                graph.setSeries(detail.graph.series);
            else
                graph.setValues(detail.graph.series[0].values);
            const wrap = new St.BoxLayout({style_class: 'osmin-reading-graph', x_expand: true});
            wrap.add_child(graph);
            card.add_child(wrap);
        }
        const rows = detail.rows.filter(Boolean);
        rows.forEach(([label, value], i) => {
            if (i > 0 || detail.graph)
                card.add_child(menuDivider());
            card.add_child(valueRow(label, String(value)).actor);
        });
        if (detail.graph || rows.length)
            body.add_child(card);

        const more = new St.Button({style_class: 'osmin-reading-more', can_focus: true, x_expand: true,
            label: 'Open in the quick panel'});
        more.connect('clicked', () => {
            this._items.get(id)?.button.menu.close();
            this._openPage(detail.page);
        });
        body.add_child(more);
    }

    destroy() {
        for (const item of this._items.values())
            item.button.destroy();
        this._items.clear();
    }
}
