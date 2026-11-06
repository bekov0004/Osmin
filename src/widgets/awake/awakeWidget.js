import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {ToolActions} from '../../tools/toolActions.js';
import {collapsible, iconRow, iconChoices, colorDots, menuCard, menuChips, menuDivider, menuRow, pillButton, setChecked, switchRow} from '../../ui/menuKit.js';
import {OsminWidget} from '../widget.js';

const CHIPS = [[15, '15m'], [30, '30m'], [60, '1h'], [120, '2h'], [240, '4h'], [480, '8h'], [-1, '∞']]; // minutes; -1 until turned off
const ICONS = ['weather-clear-night-symbolic', 'preferences-system-time-symbolic', 'view-reveal-symbolic', 'weather-clear-symbolic', 'dialog-information-symbolic'];
const COLORS = ['#ff9500', '#30d158', '#3b8ef5', '#bf5af2', '#ff453a', ''];
const COLOR_NAMES = {'#ff9500': 'Orange', '#30d158': 'Green', '#3b8ef5': 'Blue', '#bf5af2': 'Purple', '#ff453a': 'Red', '': 'None'};

/**
 * Keep awake: the computer does not sleep for a while or until you turn it off, optionally with the
 * lid closed. The icon of the top-bar button shows while it is on, in the icon and colour you pick.
 */
export class AwakeWidget extends OsminWidget {
    static id = 'awake';
    static title = 'Keep awake';
    static iconName = 'weather-clear-night-symbolic';
    static menuNative = true;

    constructor(context) {
        super(context);
        this._actions = new ToolActions(context);
        this._chipOn = null;
        this._settings = context.settings;
    }

    start() {
        this._actions.watch(this, () => this._update());
        this._settings?.connectObject('changed', (_s, key) => /^awake-/.test(key) && this._update(), this);
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-awake osmin-menu-page', x_expand: true});
        const card = menuCard();
        card.add_style_class_name('osmin-bigcard');
        root.add_child(card);

        this._main = switchRow({title: 'The computer follows its normal energy rules', onToggle: on => this._actions.setAwake(on ? -1 : 0)});
        this._mainTitle = this._main.title;
        card.add_child(this._main.row);

        const chips = menuChips([...CHIPS.map(([minutes, label]) => ({id: String(minutes), label})), {id: 'until', label: 'Until…', icon: 'preferences-system-time-symbolic'}],
            id => id === 'until' ? this._toggleUntil() : this._chip(Number(id)), {perRow: 4});
        chips.actor.add_style_class_name('osmin-card-pad');
        card.add_child(chips.actor);
        this._chips = chips.buttons;

        this._untilRow = new St.BoxLayout({style_class: 'osmin-value-row', x_expand: true, visible: false});
        this._untilRow.add_child(new St.Label({text: 'Until (hh:mm)', style_class: 'osmin-value-label', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        this._untilEntry = new St.Entry({style_class: 'osmin-entry', text: '', hint_text: '18:30', width: 90});
        this._untilRow.add_child(this._untilEntry);
        this._untilRow.add_child(pillButton({label: 'Start', onClick: () => this._startUntil()}));
        card.add_child(this._untilRow);
        card.add_child(new St.Label({text: 'Click a chip to start. Click it again to stop.', style_class: 'osmin-hint'}));

        const options = collapsible('Options', {open: true});
        card.add_child(options.actor);
        const sub = new St.BoxLayout({vertical: true, style_class: 'osmin-subcard', x_expand: true});
        const iconLine = new St.BoxLayout({x_expand: true, style_class: 'osmin-value-row'});
        iconLine.add_child(new St.Label({text: 'Active icon', style_class: 'osmin-value-label', x_expand: true}));
        iconLine.add_child(new St.Label({text: 'Top bar icon', style_class: 'osmin-value-muted'}));
        sub.add_child(iconLine);
        this._icons = iconChoices(ICONS, icon => this._settings?.gsettings?.set_string('awake-icon', icon));
        sub.add_child(this._icons.actor);
        const colorLine = new St.BoxLayout({x_expand: true, style_class: 'osmin-value-row'});
        colorLine.add_child(new St.Label({text: 'Active icon color', style_class: 'osmin-value-label', x_expand: true}));
        this._colorName = new St.Label({text: '', style_class: 'osmin-value-muted'});
        colorLine.add_child(this._colorName);
        sub.add_child(colorLine);
        this._colors = colorDots(COLORS, color => this._settings?.gsettings?.set_string('awake-color', color));
        sub.add_child(this._colors.actor);
        options.body.add_child(sub);

        this._display = this._optionRow('video-display-symbolic', 'Allow the display to sleep', on => this._actions.power?.call('setDisplaySleep', {allow: on}));
        options.body.add_child(this._display.row);
        const gs = this._settings?.gsettings;
        this._onStart = this._optionRow('media-playback-start-symbolic', 'Keep awake when Osmin opens', on => gs?.set_boolean('awake-on-start', on));
        this._onStart.set(!!gs?.get_boolean('awake-on-start'));
        options.body.add_child(this._onStart.row);
        card.add_child(menuDivider());
        this._lid = switchRow({title: 'Keep going with the lid closed', subtitle: 'Works without an administrator password', onToggle: on => this._setLid(on)});
        card.add_child(this._lid.row);

        this._update();
        return root;
    }

    _optionRow(icon, title, onToggle) {
        const toggle = new PopupMenu.Switch(false);
        const {row} = iconRow({icon, title, control: toggle, onClick: () => onToggle(!toggle.state)});
        row.add_style_class_name('osmin-option-line');
        return {row, set: on => (toggle.state = on)};
    }

    _toggleUntil() {
        this._untilRow.visible = !this._untilRow.visible;
    }

    /** "hh:mm" -> minutes from now to the next time it is that o'clock. */
    _startUntil() {
        const match = this._untilEntry.text.trim().match(/^(\d{1,2}):(\d{2})$/);
        if (!match)
            return;
        const now = GLib.DateTime.new_now_local();
        let target = GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), Number(match[1]), Number(match[2]), 0);
        if (target.to_unix() <= now.to_unix())
            target = target.add_days(1);
        this._chipOn = null;
        this._actions.setAwake(Math.max(1, Math.round((target.to_unix() - now.to_unix()) / 60)));
        this._untilRow.visible = false;
    }

    async _setLid(on) {
        try {
            await this._actions.power.call('setLid', {on});
        } catch (e) {
            this._actions.say('dialog-warning-symbolic', 'Lid', e.message);
        }
    }

    /** A chip starts that time; the same chip again stops it. */
    _chip(minutes) {
        if (this._actions.awake.active && this._chipOn === minutes)
            this._actions.setAwake(0);
        else
            this._actions.setAwake(minutes);
        this._chipOn = minutes;
    }

    _update() {
        const awake = this._actions.awake;
        const icon = this._settings?.get('awake-icon') ?? ICONS[0];
        const color = this._settings?.get('awake-color') ?? '';
        this.context.ui?.setBarLook?.(awake.active ? icon : null, awake.active ? color : null);
        if (!this._view)
            return;
        this._main.set(awake.active);
        this._mainTitle.text = awake.forever ? 'Awake until you turn it off'
            : awake.until > Date.now() ? `Awake, ${Math.ceil((awake.until - Date.now()) / 60000)} minutes left`
                : 'The computer follows its normal energy rules';
        for (const [minutes, chip] of this._chips)
            setChecked(chip, awake.active && minutes !== 'until' && (awake.forever ? minutes === '-1' : minutes === String(this._chipOn)));
        this._icons.set(icon);
        this._colors.set(color);
        this._colorName.text = COLOR_NAMES[color] ?? '';
        this._display.set(!!this._actions.power?.state?.allowDisplaySleep);
        this._lid.set(!!this._actions.power?.state?.lid);
    }

    onPageShown() {
        this._update();
    }

    destroy() {
        this._settings?.disconnectObject(this);
        this._actions.unwatch(this);
        this.context.ui?.setBarLook?.(null, null);
        this._actions.destroy();
        super.destroy();
    }
}
