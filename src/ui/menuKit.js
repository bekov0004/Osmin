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
