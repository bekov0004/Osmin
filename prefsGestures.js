import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {gettext as _} from './prefsText.js';

import {ACTIONS, DEFAULT_GESTURES, gestureMap} from './src/gestures/catalog.js';
import {focusLeftWindow, grabSystemKeys, shortcutFor} from './prefsUtilities.js';

// (gettext works only once the settings are open: the names are made when they are needed)
const groups = () => [
    [_('Three fingers'), ['swipe3-left', 'swipe3-right', 'swipe3-up', 'swipe3-down']],
    [_('Four fingers'), ['swipe4-left', 'swipe4-right', 'swipe4-up', 'swipe4-down']],
    [_('Pinch'), ['pinch3-in', 'pinch3-out', 'pinch4-in', 'pinch4-out']],
    [_('Rest the fingers'), ['hold3', 'hold4']],
];

const names = () => ({
    left: _('Swipe left'), right: _('Swipe right'), up: _('Swipe up'), down: _('Swipe down'),
    in: _('Pinch in (fingers together)'), out: _('Pinch out (fingers apart)'),
});

function gestureName(id) {
    const [, kind, fingers, direction] = /^(swipe|pinch|hold)(\d)(?:-(\w+))?$/.exec(id);
    if (kind === 'hold')
        return _('%d fingers rest and lift').format(Number(fingers));
    const name = names()[direction];
    return kind === 'pinch' ? `${name} · ${fingers}` : name;
}

/** A small picture of the gesture: the fingers as dots and where they go. */
function gesturePicture(id) {
    const [, kind, fingers, direction] = /^(swipe|pinch|hold)(\d)(?:-(\w+))?$/.exec(id);
    const n = Number(fingers);
    const area = new Gtk.DrawingArea({content_width: 44, content_height: 44, valign: Gtk.Align.CENTER, css_classes: ['osmin-gesture-pic']});
    area.set_draw_func((widget, cr, w, h) => {
        const color = widget.get_color?.() ?? new Gdk.RGBA({red: 1, green: 1, blue: 1, alpha: 1});
        const ink = alpha => cr.setSourceRGBA(color.red, color.green, color.blue, color.alpha * alpha);
        // the touchpad
        ink(0.18);
        const r = 7;
        cr.newSubPath();
        cr.arc(w - r - 2, r + 2, r, -Math.PI / 2, 0);
        cr.arc(w - r - 2, h - r - 2, r, 0, Math.PI / 2);
        cr.arc(r + 2, h - r - 2, r, Math.PI / 2, Math.PI);
        cr.arc(r + 2, r + 2, r, Math.PI, 1.5 * Math.PI);
        cr.closePath();
        cr.setLineWidth(1.5);
        cr.stroke();
        const cx = w / 2;
        const cy = h / 2;
        const dots = [];
        const row = y => {
            for (let i = 0; i < n; i++)
                dots.push([cx + (i - (n - 1) / 2) * 6.5, y, 0]);
        };
        if (kind === 'pinch') {
            for (let i = 0; i < n; i++) {
                const a = -Math.PI / 2 + i * 2 * Math.PI / n;
                dots.push([cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, a]);
            }
        } else if (kind === 'hold' || direction === 'left' || direction === 'right') {
            row(kind === 'hold' ? cy : cy - 6);
        } else {
            row(direction === 'up' ? cy + 9 : cy - 9);
        }
        ink(0.95);
        for (const [x, y] of dots) {
            cr.arc(x, y, 2.6, 0, 2 * Math.PI);
            cr.fill();
        }
        ink(0.8);
        cr.setLineWidth(1.6);
        const arrow = (x1, y1, x2, y2) => {
            cr.moveTo(x1, y1);
            cr.lineTo(x2, y2);
            cr.stroke();
            const a = Math.atan2(y2 - y1, x2 - x1);
            cr.moveTo(x2, y2);
            cr.lineTo(x2 - 4 * Math.cos(a - 0.5), y2 - 4 * Math.sin(a - 0.5));
            cr.moveTo(x2, y2);
            cr.lineTo(x2 - 4 * Math.cos(a + 0.5), y2 - 4 * Math.sin(a + 0.5));
            cr.stroke();
        };
        if (kind === 'swipe') {
            if (direction === 'left' || direction === 'right') {
                const d = direction === 'left' ? -1 : 1;
                arrow(cx - d * 9, cy + 7, cx + d * 10, cy + 7);
            } else {
                const d = direction === 'up' ? -1 : 1;
                arrow(cx, cy - d * 4, cx, cy + d * 14);
            }
        } else if (kind === 'pinch') {
            for (const [x, y, a] of dots) {
                const out = direction === 'out';
                arrow(x + Math.cos(a) * (out ? 3 : 8), y + Math.sin(a) * (out ? 3 : 8), x + Math.cos(a) * (out ? 8 : 3.5), y + Math.sin(a) * (out ? 8 : 3.5));
            }
        } else {
            ink(0.5);
            cr.arc(cx, cy, 13, 0, 2 * Math.PI);
            cr.stroke();
        }
    });
    return area;
}

export const gestureMethods = {
    /** Touchpad gestures everywhere: each gesture with a picture and what it does. */
    _touchpadGesturesPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);

        this._toggleRow(form, settings, 'touchpad-gestures', _('Touchpad'), _('Gestures everywhere'),
            _('Three and four fingers on the touchpad, anywhere on the desktop. Two fingers stay with the apps (scrolling, zoom). In the overview, GNOME\'s own gestures work as usual.'));
        this._row(form, _('Sensitivity'), this._slider(settings, 'gesture-sensitivity', [50, 200, 5]),
            _('More: a shorter move of the fingers is enough.'));
        this._rule(form);

        const actions = ACTIONS.filter(a => a.id !== 'keys');
        const titles = actions.map(a => _(a.title));
        titles.push(_('Press keys…'));
        const saved = () => settings.get_value('gesture-actions').deepUnpack();
        const setOne = (id, value) => {
            const all = {...saved(), [id]: value};
            if (DEFAULT_GESTURES[id] === value || (!DEFAULT_GESTURES[id] && value === 'none'))
                delete all[id];
            settings.set_value('gesture-actions', new GLib.Variant('a{ss}', all));
        };

        for (const [title, ids] of groups()) {
            form.append(new Gtk.Label({label: title, css_classes: ['s-card-title'], xalign: 0, margin_start: 4}));
            for (const id of ids) {
                const drop = new Gtk.DropDown({
                    model: Gtk.StringList.new(titles),
                    enable_search: true,
                    expression: Gtk.PropertyExpression.new(Gtk.StringObject, null, 'string'),
                    css_classes: ['osmin-drop'],
                });
                const keys = new Gtk.Button({css_classes: ['osmin-btn'], visible: false});
                const box = new Gtk.Box({spacing: 8, valign: Gtk.Align.CENTER});
                box._inline = true;
                box.append(keys);
                box.append(drop);
                let syncing = false;
                let recording = false;
                const sync = () => {
                    const value = gestureMap(saved())[id];
                    syncing = true;
                    drop.selected = value.startsWith('keys:') ? titles.length - 1 : Math.max(0, actions.findIndex(a => a.id === value));
                    syncing = false;
                    keys.visible = value.startsWith('keys:');
                    if (!recording)
                        keys.label = value.startsWith('keys:') && value.length > 5 ? Gtk.accelerator_get_label(...Gtk.accelerator_parse(value.slice(5)).slice(1)) : _('Set keys');
                };
                const record = () => {
                    recording = true;
                    keys.label = _('Press keys…');
                    keys.visible = true;
                    grabSystemKeys(keys, true);
                    keys.grab_focus();
                };
                const stop = () => {
                    if (!recording)
                        return;
                    recording = false;
                    grabSystemKeys(keys, false);
                    sync();
                };
                drop.connect('notify::selected', () => {
                    if (syncing)
                        return;
                    if (drop.selected === titles.length - 1) {
                        const now = gestureMap(saved())[id];
                        if (!now.startsWith('keys:'))
                            setOne(id, 'keys:');
                        record();
                    } else {
                        setOne(id, actions[drop.selected]?.id ?? 'none');
                    }
                });
                keys.connect('clicked', record);
                const controller = new Gtk.EventControllerKey();
                controller.connect('key-pressed', (_c, keyval, keycode, state) => {
                    if (!recording)
                        return false;
                    if (keyval === Gdk.KEY_Escape && (state & Gtk.accelerator_get_default_mod_mask()) === 0) {
                        stop();
                        return true;
                    }
                    const result = shortcutFor(keys, keyval, keycode, state);
                    if (result.wait)
                        return true;
                    if (result.error && !/^(Left|Right|Up|Down|Page_Up|Page_Down|Home|End|Delete|Return|space|Tab)$/.test(Gdk.keyval_name(keyval) ?? '')) {
                        keys.label = result.error;
                        return true;
                    }
                    // for a gesture a lone key is fine too (an arrow, Page Down, Enter ...)
                    const accel = result.accel ?? Gtk.accelerator_name(Gdk.keyval_to_lower(keyval), state & Gtk.accelerator_get_default_mod_mask());
                    setOne(id, `keys:${accel}`);
                    stop();
                    return true;
                });
                keys.add_controller(controller);
                const focus = new Gtk.EventControllerFocus();
                focus.connect('leave', () => !focusLeftWindow(keys) && stop());
                keys.add_controller(focus);
                const changed = settings.connect('changed::gesture-actions', sync);
                box.connect('destroy', () => settings.disconnect(changed));
                sync();

                const card = this._cardOf(form);
                if (card._rows > 0)
                    card.append(new Gtk.Separator());
                card._rows++;
                const row = new Gtk.Box({css_classes: ['s-row'], spacing: 14});
                row.append(gesturePicture(id));
                row.append(new Gtk.Label({label: gestureName(id), css_classes: ['s-row-title'], xalign: 0, hexpand: true, wrap: true}));
                row.append(box);
                card.append(row);
            }
            this._rule(form);
        }

        this._row(form, _('Apps'), new Gtk.Box(),
            _('"Switch apps" works like holding Alt and pressing Tab: the switcher stays while the fingers are on the touchpad, moving on picks the next app, moving back the one before, and lifting the fingers opens it. "Press keys" sends a keyboard shortcut to the app in front (for example Ctrl+W).'));
        this._resetRow(form, settings, ['touchpad-gestures', 'gesture-actions', 'gesture-sensitivity'], _('Back to the defaults'));
        return body;
    },
};
