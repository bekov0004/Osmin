import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as R from '../../utils/reminders.js';
import {menuCard, menuChip, menuHeader, setChecked} from '../../ui/menuKit.js';
import {OsminWidget} from '../widget.js';

const REPEAT_LABELS = [['once', 'Once'], ['daily', 'Every day'], ['weekdays', 'Weekdays']];
const SOON = [[5, '+5 min'], [15, '+15 min'], [30, '+30 min'], [60, '+1 h']];

const pad = n => String(n).padStart(2, '0');
const inMinutes = minutes => {
    const at = new Date(Date.now() + minutes * 60000);
    return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

/**
 * Reminders: at the time you choose the butterfly of the capsule flies out, grows and shows your text. Here: a new
 * one (the time, or "in 5 min"; the text; once, every day or on weekdays), the list (on/off, remove), and a try.
 */
export class RemindersWidget extends OsminWidget {
    static id = 'reminders';
    static title = 'Reminders';
    static iconName = 'alarm-symbolic';
    static menuNative = true;

    constructor(context) {
        super(context);
        this._reminders = context.services.reminders;
        this._repeat = 'once';
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-reminders osmin-menu-page', x_expand: true});

        const card = menuCard();
        const timeRow = new St.BoxLayout({style_class: 'osmin-card-pad osmin-rem-row', x_expand: true});
        this._time = new St.Entry({style_class: 'osmin-entry osmin-rem-time', hint_text: '18:30', can_focus: true});
        this._time.clutter_text.connect('activate', () => this._text.grab_key_focus());
        timeRow.add_child(this._time);
        for (const [minutes, label] of SOON) {
            timeRow.add_child(menuChip({label, onClick: () => {
                this._time.text = inMinutes(minutes);
                this._text.grab_key_focus();
            }}));
        }
        card.add_child(timeRow);
        const textRow = new St.BoxLayout({style_class: 'osmin-card-pad', x_expand: true});
        this._text = new St.Entry({style_class: 'osmin-entry', hint_text: 'What should the butterfly tell you?', can_focus: true, x_expand: true});
        this._text.clutter_text.connect('activate', () => this._add());
        textRow.add_child(this._text);
        card.add_child(textRow);
        const repeatRow = new St.BoxLayout({style_class: 'osmin-chips-row osmin-card-pad', x_expand: true});
        this._repeatChips = new Map();
        for (const [id, label] of REPEAT_LABELS) {
            const chip = menuChip({label, onClick: () => {
                this._repeat = id;
                this._syncRepeat();
            }});
            this._repeatChips.set(id, chip);
            repeatRow.add_child(chip);
        }
        card.add_child(repeatRow);
        const actions = new St.BoxLayout({style_class: 'osmin-chips-row osmin-card-pad', x_expand: true});
        actions.add_child(menuChip({label: 'Add', icon: 'list-add-symbolic', primary: true, onClick: () => this._add()}));
        actions.add_child(menuChip({label: 'Try it', icon: 'media-playback-start-symbolic', onClick: () => this._try()}));
        card.add_child(actions);
        this._note = new St.Label({style_class: 'osmin-hint', visible: false});
        card.add_child(this._note);
        root.add_child(card);
        this._syncRepeat();

        this._listHeader = menuHeader('Coming up');
        root.add_child(this._listHeader);
        this._list = menuCard();
        root.add_child(this._list);

        this._reminders.connectObject('changed', () => this._rebuild(), this);
        return root;
    }

    onViewCreated() {
        this._rebuild();
    }

    onPageShown() {
        this._rebuild();
        // opened from the capsule's butterfly: straight to writing
        if (!this._time.text)
            this._time.text = inMinutes(15);
        this._text.grab_key_focus();
    }

    _syncRepeat() {
        for (const [id, chip] of this._repeatChips)
            setChecked(chip, id === this._repeat);
    }

    _say(text) {
        this._note.text = text;
        this._note.visible = !!text;
    }

    _add() {
        try {
            this._reminders.add({time: this._time.text, text: this._text.text || 'Reminder', repeat: this._repeat});
            this._text.text = '';
            this._time.text = '';
            this._say('');
        } catch (e) {
            this._say(e.message);
        }
    }

    _try() {
        this._reminders.preview({id: 'preview', time: R.parseTime(this._time.text) ?? inMinutes(0), text: this._text.text || 'Hello! I am your Osmin butterfly.'});
        this.context.ui?.closeCapsule?.();
    }

    _rebuild() {
        if (!this._view)
            return;
        this._list.destroy_all_children();
        const list = R.sorted(this._reminders.list);
        this._listHeader.visible = this._list.visible = list.length > 0;
        for (const reminder of list) {
            const row = new St.BoxLayout({style_class: 'osmin-card-row osmin-rem-item', x_expand: true});
            const time = new St.Label({text: reminder.time, style_class: `osmin-rem-item-time${reminder.enabled ? '' : ' off'}`, y_align: Clutter.ActorAlign.CENTER});
            row.add_child(time);
            const texts = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            const text = new St.Label({text: reminder.text || 'Reminder', style_class: 'osmin-card-title'});
            text.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            texts.add_child(text);
            const when = reminder.snoozeUntil && reminder.enabled ? 'Again in a few minutes' : R.whenText(reminder);
            texts.add_child(new St.Label({text: when, style_class: 'osmin-card-subtitle'}));
            row.add_child(texts);
            const toggle = new PopupMenu.Switch(!!reminder.enabled);
            const toggleButton = new St.Button({child: toggle, y_align: Clutter.ActorAlign.CENTER, reactive: true, can_focus: true});
            toggleButton.connect('clicked', () => this._reminders.setEnabled(reminder.id, !reminder.enabled));
            row.add_child(toggleButton);
            const remove = new St.Button({style_class: 'osmin-rem-remove', child: new St.Icon({icon_name: 'user-trash-symbolic', icon_size: 14}), y_align: Clutter.ActorAlign.CENTER, reactive: true, can_focus: true, track_hover: true});
            remove.connect('clicked', () => this._reminders.remove(reminder.id));
            row.add_child(remove);
            this._list.add_child(row);
        }
    }

    destroy() {
        this._reminders?.disconnectObject(this);
        super.destroy();
    }
}
