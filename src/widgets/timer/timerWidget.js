import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {TimerState, formatRemaining} from '../../services/timerService.js';
import {createButton} from '../../ui/button.js';
import {Priority} from '../../utils/events.js';
import {OsminWidget} from '../widget.js';
import {TimerActivity} from './timerActivity.js';

const MINUTE = 60 * 1000;
const PRESETS = [5, 10, 25, 45];

/** Set a time, start, pause, resume, reset. A Live Activity while it runs. */
export class TimerWidget extends OsminWidget {
    static id = 'timer';
    static title = 'Timer';
    static iconName = 'alarm-symbolic';

    constructor(context) {
        super(context);
        this._timer = context.services.timer;
        this._activities = context.services.activities;
        this._activity = null;
    }

    start() {
        this._activity = new TimerActivity({
            timer: this._timer,
            onDismiss: () => {
                this._activities.dismissPeek('timer');
                this._timer.reset();
            },
        });
        this._timer.connectObject(
            'changed', () => this._onChanged(),
            'tick', () => this._activity.notifyChanged(),
            'finished', (_timer, {missed}) => this._onFinished(missed),
            this);
        this._onChanged();
    }

    _onChanged() {
        this._activity.notifyChanged();
        if (this._timer.active)
            this._activities.start(this._activity);
        else
            this._activities.end('timer');
        if (this._timer.state !== TimerState.DONE)
            this._activities.dismissPeek('timer');
        this._update();
    }

    _onFinished(_missed) {
        // An alarm: show it even over the open panel, and keep it until dismissed.
        this._activities.peek(this._activity, {
            priority: Priority.HIGH, persistent: true, force: true,
        });
        try {
            global.display.get_sound_player().play_from_theme('alarm-clock-elapsed', 'Timer finished', null);
        } catch (e) {
            console.debug(`[osmin] timer sound failed: ${e.message}`);
        }
    }

    createView() {
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-widget osmin-timer',
            x_expand: true,
            y_expand: true,
        });
        root.add_child(new St.Label({text: 'TIMER', style_class: 'osmin-timer-caption'}));

        const display = new St.BoxLayout({
            style_class: 'osmin-timer-display',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._minus = createButton({
            iconName: 'list-remove-symbolic',
            styleClass: 'osmin-timer-step',
            onClick: () => this._timer.addTime(-MINUTE),
        });
        this._plus = createButton({
            iconName: 'list-add-symbolic',
            styleClass: 'osmin-timer-step',
            onClick: () => this._timer.addTime(MINUTE),
        });
        this._time = new St.Label({
            style_class: 'osmin-timer-time',
            y_align: Clutter.ActorAlign.CENTER,
        });
        for (const actor of [this._minus, this._time, this._plus])
            display.add_child(actor);
        root.add_child(display);

        this._bar = new St.Widget({
            style_class: 'osmin-timer-bar',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        this._fill = new St.Widget({
            style_class: 'osmin-timer-fill',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        this._bar.add_child(this._fill);
        this._bar.connect('notify::width', () => this._update());
        root.add_child(this._bar);

        this._presets = new St.BoxLayout({style_class: 'osmin-timer-presets', x_expand: true});
        for (const minutes of PRESETS) {
            const chip = createButton({
                label: `${minutes}m`,
                styleClass: 'osmin-timer-chip',
                expand: true,
                onClick: () => this._timer.setDuration(minutes * MINUTE),
            });
            this._presets.add_child(chip);
        }
        root.add_child(this._presets);

        this._actions = new St.BoxLayout({style_class: 'osmin-timer-actions', x_expand: true});
        root.add_child(this._actions);

        this._timer.connectObject('tick', () => this._update(), this);
        return root;
    }

    onViewCreated() {
        this._update();
    }

    destroy() {
        this._timer.disconnectObject(this);
        this._activities.end('timer');
        this._activity?.destroy();
        super.destroy();
    }

    _update() {
        if (!this._view)
            return;
        const state = this._timer.state;
        const remaining = this._timer.remaining;
        this._time.text = state === TimerState.DONE ? 'DONE' : formatRemaining(remaining);
        if (state === TimerState.DONE)
            this._time.add_style_pseudo_class('done');
        else
            this._time.remove_style_pseudo_class('done');

        const idle = state === TimerState.IDLE;
        this._minus.visible = this._plus.visible = idle;
        this._presets.visible = idle;
        this._bar.visible = !idle;
        const fraction = state === TimerState.DONE ? 1 :
            this._timer.duration > 0 ? 1 - remaining / this._timer.duration : 0;
        // Sizes can only be read once the widget is in the stage (notify::width updates us again).
        this._fill.set_width(this._bar.mapped
            ? Math.round(this._bar.width * Math.min(Math.max(fraction, 0), 1)) : 0);

        this._actions.destroy_all_children();
        const add = (label, iconName, handler, primary = false) => this._actions.add_child(createButton({
            label,
            iconName,
            styleClass: `osmin-timer-action${primary ? ' osmin-timer-primary' : ''}`,
            expand: true,
            onClick: handler,
        }));
        switch (state) {
        case TimerState.IDLE:
            add('Start', 'media-playback-start-symbolic', () => this._timer.start(), true);
            break;
        case TimerState.RUNNING:
            add('Pause', 'media-playback-pause-symbolic', () => this._timer.pause(), true);
            add('Reset', 'view-refresh-symbolic', () => this._timer.reset());
            break;
        case TimerState.PAUSED:
            add('Resume', 'media-playback-start-symbolic', () => this._timer.resume(), true);
            add('Reset', 'view-refresh-symbolic', () => this._timer.reset());
            break;
        case TimerState.DONE:
            add('+1 min', 'list-add-symbolic', () => this._timer.addTime(MINUTE), true);
            add('Reset', 'view-refresh-symbolic', () => this._timer.reset());
            break;
        }
    }
}
