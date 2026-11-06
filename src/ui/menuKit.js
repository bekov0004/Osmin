import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Building blocks for the pages of the top-bar button's window: a small header, a rounded card, rows
// with a switch, and chips. Every page is made of these so the window reads as one design.

/** A small muted capital header above a card ("KEEP AWAKE"). */
export function menuHeader(text) {
    return new St.Label({text: text.toUpperCase(), style_class: 'osmin-menu-header'});
}

/** A rounded card; rows and other things go inside it. */
export function menuCard() {
    return new St.BoxLayout({vertical: true, style_class: 'osmin-card', x_expand: true});
}

/** A thin line between two rows of a card. */
export function menuDivider() {
    return new St.Widget({style_class: 'osmin-card-divider', x_expand: true});
}

/**
 * A row of a card: a title (and a muted line under it) on the left, a control on the right.
 * @param {{title: string, subtitle?: string, control?: Clutter.Actor, onClick?: Function}} options
 * @returns {{row: St.Widget, title: St.Label, subtitle: St.Label|null}}
 */
export function menuRow({title, subtitle = '', control = null, onClick = null}) {
    const row = new St.Button({style_class: 'osmin-card-row', x_expand: true, reactive: !!onClick, can_focus: !!onClick, track_hover: !!onClick});
    const box = new St.BoxLayout({x_expand: true});
    const text = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    const titleLabel = new St.Label({text: title, style_class: 'osmin-card-title'});
    text.add_child(titleLabel);
    let subtitleLabel = null;
    if (subtitle) {
        subtitleLabel = new St.Label({text: subtitle, style_class: 'osmin-card-subtitle'});
        subtitleLabel.clutter_text.line_wrap = true;
        text.add_child(subtitleLabel);
    }
    box.add_child(text);
    if (control) {
        control.y_align = Clutter.ActorAlign.CENTER;
        box.add_child(control);
    }
    row.set_child(box);
    if (onClick)
        row.connect('clicked', () => onClick());
    return {row, title: titleLabel, subtitle: subtitleLabel};
}

/** A switch row: clicking anywhere on it toggles. @returns {{row: St.Widget, set: Function}} */
export function switchRow({title, subtitle = '', state = false, onToggle}) {
    const toggle = new PopupMenu.Switch(state);
    const {row, subtitle: subtitleLabel} = menuRow({title, subtitle, control: toggle, onClick: () => onToggle(!toggle.state)});
    return {
        row,
        set: value => {
            toggle.state = value;
        },
        setSubtitle: text => {
            if (subtitleLabel)
                subtitleLabel.text = text;
        },
    };
}

/** One pill button; `primary` makes it the filled, highlighted one. */
export function menuChip({label, icon = null, primary = false, onClick}) {
    const chip = new St.Button({style_class: `osmin-chip${primary ? ' osmin-chip-primary' : ''}`, can_focus: true, x_expand: true, reactive: true, track_hover: true});
    const content = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
    if (icon)
        content.add_child(new St.Icon({icon_name: icon, style_class: 'osmin-chip-icon'}));
    content.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
    chip.set_child(content);
    chip.connect('clicked', () => onClick());
    return chip;
}

/**
 * Pill buttons in rows of `perRow`.
 * @param {{id: string, label: string, icon?: string}[]} items
 * @returns {{actor: St.Widget, buttons: Map<string, St.Button>}}
 */
export function menuChips(items, onPick, {perRow = 4} = {}) {
    const box = new St.BoxLayout({vertical: true, style_class: 'osmin-chips', x_expand: true});
    const buttons = new Map();
    let row = null;
    items.forEach(({id, label, icon}, index) => {
        if (index % perRow === 0) {
            row = new St.BoxLayout({style_class: 'osmin-chips-row', x_expand: true});
            box.add_child(row);
        }
        const chip = new St.Button({style_class: 'osmin-chip', can_focus: true, x_expand: true, reactive: true, track_hover: true});
        const content = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        if (icon)
            content.add_child(new St.Icon({icon_name: icon, style_class: 'osmin-chip-icon'}));
        const text = new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER});
        content.add_child(text);
        chip.set_child(content);
        chip.connect('clicked', () => onPick(id));
        row.add_child(chip);
        buttons.set(id, chip);
    });
    // Fill the last row so its chips keep the same width as the rest.
    const missing = (perRow - items.length % perRow) % perRow;
    for (let i = 0; i < missing; i++)
        row.add_child(new St.Widget({x_expand: true, style_class: 'osmin-chip-spacer'}));
    return {actor: box, buttons};
}

/** Marks a chip or tab as on or off. */
export function setChecked(actor, on) {
    if (on)
        actor.add_style_pseudo_class('checked');
    else
        actor.remove_style_pseudo_class('checked');
}

/** A thin bar that fills from the left. @returns {{actor: St.Widget, set: (fraction: number, warn?: boolean) => void}} */
export function usageBar() {
    const track = new St.Widget({style_class: 'osmin-system-bar', x_expand: true, layout_manager: new Clutter.BinLayout()});
    const fill = new St.Widget({style_class: 'osmin-system-fill', x_align: Clutter.ActorAlign.START, x_expand: true});
    track.add_child(fill);
    let fraction = 0;
    let warning = false;
    const apply = () => {
        if (!track.mapped)
            return;
        fill.set_width(Math.round(track.width * Math.min(Math.max(fraction, 0), 1)));
        if (warning)
            fill.add_style_pseudo_class('warn');
        else
            fill.remove_style_pseudo_class('warn');
    };
    track.connect('notify::width', apply);
    track.connect('notify::mapped', apply);
    return {
        actor: track,
        set: (value, warn = false) => {
            fraction = value;
            warning = warn;
            if (track.mapped) {
                if (warn)
                    fill.add_style_pseudo_class('warn');
                else
                    fill.remove_style_pseudo_class('warn');
            }
            apply();
        },
    };
}

/** A number with a small label above it: "CPU" / "45°C". @returns {{actor: St.BoxLayout, set: (text: string) => void}} */
export function statTile(label, value = '–') {
    const actor = new St.BoxLayout({vertical: true, style_class: 'osmin-stat', x_expand: true});
    actor.add_child(new St.Label({text: label, style_class: 'osmin-stat-label'}));
    const valueLabel = new St.Label({text: value, style_class: 'osmin-stat-value'});
    actor.add_child(valueLabel);
    return {actor, set: text => (valueLabel.text = text)};
}

/** A small rounded status pill ("Normal"); `tone` is 'good', 'warn' or 'bad'. */
export function statusPill(text, tone = 'good') {
    const label = new St.Label({text, style_class: `osmin-pill osmin-pill-${tone}`, y_align: Clutter.ActorAlign.CENTER});
    return {actor: label, set: (value, newTone = tone) => {
        label.text = value;
        label.style_class = `osmin-pill osmin-pill-${newTone}`;
    }};
}

/** A small muted label inside a card ("Temperatures"), with an optional control on the right. */
export function sectionLabel(text, control = null) {
    const row = new St.BoxLayout({style_class: 'osmin-section-label', x_expand: true});
    row.add_child(new St.Label({text, x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
    if (control)
        row.add_child(control);
    return row;
}

/** A line with a label on the left and a value on the right. @returns {{actor: St.BoxLayout, set: (text: string) => void}} */
export function valueRow(label, value = '–', {strong = false} = {}) {
    const actor = new St.BoxLayout({style_class: 'osmin-value-row', x_expand: true});
    actor.add_child(new St.Label({text: label, style_class: strong ? 'osmin-value-label osmin-value-strong' : 'osmin-value-label', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
    const text = new St.Label({text: value, style_class: strong ? 'osmin-value-text osmin-value-strong' : 'osmin-value-text', y_align: Clutter.ActorAlign.CENTER});
    actor.add_child(text);
    return {actor, set: v => (text.text = v), label: actor.get_first_child()};
}

/** A tile with an icon and a label over a big number, for the temperatures. */
export function bigTile(label, icon = null) {
    const actor = new St.BoxLayout({vertical: true, style_class: 'osmin-big-tile', x_expand: true});
    const head = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, style_class: 'osmin-big-tile-head'});
    if (icon)
        head.add_child(new St.Icon({icon_name: icon, style_class: 'osmin-big-tile-icon'}));
    head.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
    actor.add_child(head);
    const value = new St.Label({text: '–', style_class: 'osmin-big-tile-value', x_align: Clutter.ActorAlign.CENTER});
    actor.add_child(value);
    return {actor, set: text => (value.text = text)};
}

/** A small pill button for the actions inside a card ("Open", "Speed test"). */
export function pillButton({label, icon = null, onClick}) {
    const button = new St.Button({style_class: 'osmin-pillbtn', can_focus: true, reactive: true, track_hover: true, x_align: Clutter.ActorAlign.START});
    const box = new St.BoxLayout();
    if (icon)
        box.add_child(new St.Icon({icon_name: icon, style_class: 'osmin-pillbtn-icon'}));
    box.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
    button.set_child(box);
    button.connect('clicked', () => onClick());
    return button;
}

/**
 * A usage line: a chevron that opens a detail box, a name, a bar and the percent.
 * @returns {{actor: St.BoxLayout, detail: St.BoxLayout, set: (percent: number, warn?: boolean) => void, setLabel: (text: string) => void}}
 */
export function meterRow(label, {icon = null, expandable = false} = {}) {
    const actor = new St.BoxLayout({vertical: true, x_expand: true});
    const line = new St.BoxLayout({style_class: 'osmin-meter-row', x_expand: true});
    const detail = new St.BoxLayout({vertical: true, style_class: 'osmin-meter-detail', x_expand: true, visible: false});
    const chevron = new St.Icon({icon_name: 'pan-end-symbolic', style_class: 'osmin-meter-chevron', y_align: Clutter.ActorAlign.CENTER});
    const lead = new St.Button({style_class: 'osmin-meter-lead', reactive: expandable, can_focus: expandable, track_hover: expandable});
    const leadBox = new St.BoxLayout();
    if (icon)
        leadBox.add_child(new St.Icon({icon_name: icon, style_class: 'osmin-meter-icon'}));
    else if (expandable)
        leadBox.add_child(chevron);
    const name = new St.Label({text: label, style_class: 'osmin-meter-label', y_align: Clutter.ActorAlign.CENTER});
    leadBox.add_child(name);
    lead.set_child(leadBox);
    line.add_child(lead);
    const bar = usageBar();
    bar.actor.y_align = Clutter.ActorAlign.CENTER;
    line.add_child(bar.actor);
    const percent = new St.Label({text: '–', style_class: 'osmin-meter-percent', y_align: Clutter.ActorAlign.CENTER});
    line.add_child(percent);
    actor.add_child(line);
    actor.add_child(detail);
    if (expandable) {
        lead.connect('clicked', () => {
            detail.visible = !detail.visible;
            chevron.icon_name = detail.visible ? 'pan-down-symbolic' : 'pan-end-symbolic';
        });
    }
    return {
        actor,
        detail,
        set: (value, warn = false) => {
            percent.text = `${Math.round(value)}%`;
            bar.set(value / 100, warn);
        },
        setLabel: text => (name.text = text),
    };
}
