import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {HorizontalSlider} from '../../ui/horizontalSlider.js';
import {dropAt, placeSide, SIDES, sideOf} from '../../displays/arrange.js';
import {ArrangeMap} from '../../displays/arrangeMap.js';
import {checkRow, collapsible, iconRow, menuCard, menuChip, menuChips, menuDivider, menuHeader, setChecked} from '../../ui/menuKit.js';
import {OsminWidget} from '../widget.js';

const POWER_SCHEMA = 'org.gnome.settings-daemon.plugins.power';
const SIDE_LABELS = {left: 'Left', right: 'Right', above: 'Above', below: 'Below'};
const SIDE_ICONS = {left: 'go-previous-symbolic', right: 'go-next-symbolic', above: 'go-up-symbolic', below: 'go-down-symbolic'};
const SIDE_WORDS = {left: 'left of', right: 'right of', above: 'above', below: 'below'};

/**
 * Displays: the brightness of every monitor (see displayService.js: GNOME's control, ddcutil, or Osmin dimming the
 * picture) and of the keyboard light, night light and automatic brightness, and where the monitors stand: a picture to
 * drag them around, a side for each one, the main one, and join / mirror / only one.
 */
export class DisplaysWidget extends OsminWidget {
    static id = 'displays';
    static title = 'Displays';
    static iconName = 'video-display-symbolic';
    static menuNative = true;

    constructor(context) {
        super(context);
        this._keyboard = null;
        this._cancellable = new Gio.Cancellable();
        try {
            this._color = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'});
        } catch (e) {
            this._color = null;
        }
        try {
            this._power = new Gio.Settings({schema_id: POWER_SCHEMA});
        } catch (e) {
            this._power = null;
        }
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-displays osmin-menu-page', x_expand: true});
        const card = menuCard();
        card.add_style_class_name('osmin-bigcard');
        root.add_child(card);

        this._list = new St.BoxLayout({vertical: true, x_expand: true});
        card.add_child(this._list);

        this._kbdBox = new St.BoxLayout({vertical: true, x_expand: true, visible: false});
        this._kbdBox.add_child(menuDivider());
        this._kbd = this._sliderRow('input-keyboard-symbolic', 'Keyboard light', value => this._setKeyboard(value));
        this._kbdBox.add_child(this._kbd.actor);
        card.add_child(this._kbdBox);
        this._firstDivider = menuDivider();
        card.add_child(this._firstDivider);

        const switches = [
            ['Night light', 'weather-clear-night-symbolic', () => this._color?.get_boolean('night-light-enabled'), on => this._color?.set_boolean('night-light-enabled', on)],
            ['Automatic brightness', 'display-brightness-symbolic', () => this._power?.get_boolean('ambient-enabled'), on => this._power?.set_boolean('ambient-enabled', on)],
        ];
        this._switches = [];
        for (const [title, icon, get, set] of switches) {
            if ((title === 'Night light' && !this._color) || (title !== 'Night light' && !this._power))
                continue;
            const toggle = new PopupMenu.Switch(false);
            const {row} = iconRow({icon, title, control: toggle, onClick: () => set(!toggle.state)});
            row.add_style_class_name('osmin-option-line');
            card.add_child(row);
            card.add_child(menuDivider());
            this._switches.push({toggle, get});
        }
        this._color?.connectObject('changed::night-light-enabled', () => this._sync(), this);
        this._power?.connectObject('changed', () => this._sync(), this);

        const options = collapsible('Options', {open: false});
        card.add_child(options.actor);
        if (this._power) {
            this._dim = checkRow({title: 'Dim the screen when inactive', subtitle: 'The screen gets darker after a while without activity.', state: this._power.get_boolean('idle-dim'), onToggle: on => this._power.set_boolean('idle-dim', on)});
            options.body.add_child(this._dim.row);
        }

        this._arrangeBox = new St.BoxLayout({vertical: true, x_expand: true});
        this._arrangeBox.add_child(menuHeader('Arrangement'));
        const arrange = menuCard();
        this._arrangeBox.add_child(arrange);
        this._map = new ArrangeMap({
            onSelect: id => {
                this._selected = id;
                this._syncArrangement();
            },
            onDrop: (id, x, y) => this._drop(id, x, y),
        });
        const mapWrap = new St.BoxLayout({style_class: 'osmin-card-pad', x_expand: true});
        mapWrap.add_child(this._map);
        arrange.add_child(mapWrap);
        this._which = new St.Label({style_class: 'osmin-arrange-which', x_expand: true});
        arrange.add_child(this._which);
        const sides = SIDES.map(side => ({id: side, label: SIDE_LABELS[side], icon: SIDE_ICONS[side]}));
        const {actor: sideChips, buttons: sideButtons} = menuChips(sides, side => this._placeSide(side), {perRow: 4});
        this._sideButtons = sideButtons;
        const sideWrap = new St.BoxLayout({style_class: 'osmin-card-pad', x_expand: true});
        sideWrap.add_child(sideChips);
        arrange.add_child(sideWrap);
        this._mainChip = menuChip({label: 'Make it the main monitor', icon: 'starred-symbolic', onClick: () => this._makeMain()});
        const mainRow = new St.BoxLayout({style_class: 'osmin-chips-row osmin-card-pad', x_expand: true});
        mainRow.add_child(this._mainChip);
        arrange.add_child(mainRow);
        arrange.add_child(menuDivider());
        this._modes = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'osmin-card-pad'});
        arrange.add_child(this._modes);
        this._arrangeNote = new St.Label({style_class: 'osmin-hint', visible: false});
        this._arrangeNote.clutter_text.line_wrap = true;
        arrange.add_child(this._arrangeNote);
        root.add_child(this._arrangeBox);

        this._firstDivider.visible = false;
        this._connectKeyboard();
        this._stopWatching = this._displays?.watch(() => this._syncDisplays()) ?? null;
        this._syncDisplays();
        this._sync();
        return root;
    }

    get _displays() {
        return this.context.services?.displays ?? null;
    }

    /** A named slider with the percent on the right (and a note under it). */
    _sliderRow(icon, name, onChange, note = '') {
        const actor = new St.BoxLayout({vertical: true, x_expand: true});
        const head = new St.BoxLayout({style_class: 'osmin-value-row', x_expand: true});
        head.add_child(new St.Icon({icon_name: icon, style_class: 'osmin-meter-icon', y_align: Clutter.ActorAlign.CENTER}));
        head.add_child(new St.Label({text: name, style_class: 'osmin-value-label osmin-value-strong', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        const percent = new St.Label({text: '', style_class: 'osmin-value-muted', y_align: Clutter.ActorAlign.CENTER});
        head.add_child(percent);
        actor.add_child(head);
        const slider = new HorizontalSlider({min: 0, max: 100, value: 50, onChange: value => {
            percent.text = `${Math.round(value)}%`;
            onChange(Math.round(value));
        }});
        const wrap = new St.BoxLayout({style_class: 'osmin-slider-row', x_expand: true});
        wrap.add_child(slider);
        actor.add_child(wrap);
        if (note) {
            const label = new St.Label({text: note, style_class: 'osmin-hint'});
            label.clutter_text.line_wrap = true;
            actor.add_child(label);
        }
        return {actor, slider, set: value => {
            slider.value = value;
            percent.text = `${Math.round(value)}%`;
        }};
    }

    _sync() {
        this._switches?.forEach(({toggle, get}) => (toggle.state = !!get()));
        this._dim?.set(this._power?.get_boolean('idle-dim') ?? false);
    }

    // --- the monitors ------------------------------------------------------------------------------------------

    _syncDisplays() {
        if (!this._list)
            return;
        this._syncBrightness();
        this._syncArrangement();
    }

    /** A slider for every monitor that is on (made again only when the monitors change, not while one is dragged). */
    _syncBrightness() {
        const entries = this._displays?.brightness() ?? [];
        const key = entries.map(e => `${e.connector}:${e.kind}:${e.name}`).join('|');
        if (key !== this._brightnessKey) {
            this._brightnessKey = key;
            this._list.destroy_all_children();
            this._rows = new Map();
            entries.forEach((entry, i) => {
                if (i > 0)
                    this._list.add_child(menuDivider());
                const note = entry.kind === 'osmin' ? 'This monitor has no brightness control of its own: Osmin dims the picture.' : '';
                const row = this._sliderRow(entry.builtin ? 'computer-symbolic' : 'video-display-symbolic', entry.name, percent => {
                    this._displays?.brightness().find(e => e.connector === entry.connector)?.set(Math.max(entry.min ?? 0, percent));
                }, note);
                this._list.add_child(row.actor);
                this._rows.set(entry.connector, row);
            });
        }
        for (const entry of entries)
            this._rows.get(entry.connector)?.set(entry.value);
        this._firstDivider.visible = entries.length > 0;
    }

    _syncArrangement() {
        const displays = this._displays;
        const rects = displays?.rects() ?? [];
        this._arrangeBox.visible = (displays?.monitorCount ?? 0) > 1;
        if (!this._arrangeBox.visible)
            return;
        if (!rects.some(r => r.id === this._selected))
            this._selected = (rects.find(r => !r.primary) ?? rects[0])?.id ?? null;
        this._map.set(rects, this._selected);
        const selected = rects.find(r => r.id === this._selected);
        const main = rects.find(r => r.primary);
        const other = selected?.primary ? rects.find(r => !r.primary) : main;
        const side = selected && other ? sideOf(selected, other) : null;
        this._which.text = !selected ? ''
            : rects.length < 2 ? `${selected.names.join(' + ')}`
                : `${selected.names.join(' + ')}${side ? ` is ${SIDE_WORDS[side]} ${selected.primary ? other.names.join(' + ') : 'the main monitor'}` : ''}`;
        for (const [id, button] of this._sideButtons) {
            setChecked(button, id === side);
            button.reactive = rects.length > 1;
        }
        this._mainChip.visible = !!selected && !selected.primary;

        // Join, mirror, or only one monitor on.
        this._modes.destroy_all_children();
        const mode = displays.mode;
        const items = [
            {id: 'join', label: 'Join', icon: 'view-dual-symbolic'},
            {id: 'mirror', label: 'Mirror', icon: 'view-mirror-symbolic'},
            ...displays.state.monitors.map(m => ({id: `only:${m.connector}`, label: `Only ${displays.nameOf(m.connector)}`, icon: m.builtin ? 'computer-symbolic' : 'video-display-symbolic'})),
        ];
        const {actor, buttons} = menuChips(items, id => this._setMode(id), {perRow: 2});
        buttons.forEach((button, id) => setChecked(button, id === mode));
        this._modes.add_child(actor);
    }

    _note(text) {
        this._arrangeNote.text = text ?? '';
        this._arrangeNote.visible = !!text;
    }

    async _run(work) {
        if (this._busy)
            return;
        this._busy = true;
        this._note(null);
        try {
            await work();
        } catch (e) {
            this._note(e.message.replace(/^GDBus\.Error:[^ ]+ /, ''));
            this._map.settle();
        } finally {
            this._busy = false;
        }
    }

    _drop(id, x, y) {
        const rects = this._displays.rects();
        const placed = dropAt(rects, id, x, y);
        if (!placed) {
            this._map.settle();
            return;
        }
        this._selected = id;
        this._run(() => this._displays.arrange(placed));
    }

    _placeSide(side) {
        const rects = this._displays.rects();
        const selected = rects.find(r => r.id === this._selected);
        if (!selected || rects.length < 2)
            return;
        const anchor = selected.primary ? rects.find(r => !r.primary) : rects.find(r => r.primary);
        const placed = placeSide(rects, selected.id, side, anchor.id);
        if (placed)
            this._run(() => this._displays.arrange(placed));
    }

    _makeMain() {
        if (this._selected)
            this._run(() => this._displays.setPrimary(this._selected));
    }

    _setMode(id) {
        const displays = this._displays;
        if (id === displays.mode)
            return;
        if (id === 'join')
            this._run(() => displays.join());
        else if (id === 'mirror')
            this._run(() => displays.mirror());
        else
            this._run(() => displays.only(id.slice('only:'.length)));
    }

    // The keyboard light, through UPower.
    _connectKeyboard() {
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, 'org.freedesktop.UPower',
            '/org/freedesktop/UPower/KbdBacklight', 'org.freedesktop.UPower.KbdBacklight', this._cancellable, (_o, result) => {
                try {
                    this._keyboard = Gio.DBusProxy.new_for_bus_finish(result);
                    this._keyboard.call_sync('GetMaxBrightness', null, Gio.DBusCallFlags.NONE, 500, null).deepUnpack();
                } catch (e) {
                    this._keyboard = null;
                    return;
                }
                this._keyboard.connectObject('g-signal', () => this._syncKeyboard(), this);
                this._kbdBox.visible = true;
                this._syncKeyboard();
            });
    }

    _syncKeyboard() {
        try {
            const [max] = this._keyboard.call_sync('GetMaxBrightness', null, Gio.DBusCallFlags.NONE, 500, null).deepUnpack();
            const [now] = this._keyboard.call_sync('GetBrightness', null, Gio.DBusCallFlags.NONE, 500, null).deepUnpack();
            this._kbdMax = max;
            this._kbd.set(max > 0 ? Math.round(100 * now / max) : 0);
        } catch (e) {
            // the keyboard light went away
        }
    }

    _setKeyboard(percent) {
        this._keyboard?.call('SetBrightness', new GLib.Variant('(i)', [Math.round((this._kbdMax ?? 1) * percent / 100)]), Gio.DBusCallFlags.NONE, 500, null, null);
    }

    onPageShown() {
        this._displays?.refresh();
        if (this._keyboard)
            this._syncKeyboard();
        this._sync();
    }

    destroy() {
        this._cancellable.cancel();
        this._color?.disconnectObject(this);
        this._power?.disconnectObject(this);
        this._stopWatching?.();
        this._stopWatching = null;
        this._keyboard?.disconnectObject(this);
        super.destroy();
    }
}
