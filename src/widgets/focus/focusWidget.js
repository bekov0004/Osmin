import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {formatClock} from '../../services/focusService.js';
import {createButton} from '../../ui/button.js';
import {EventType, Priority} from '../../utils/events.js';
import {OsminWidget} from '../widget.js';
import {FocusActivity} from './focusActivity.js';

const PHASE_NAMES = {work: 'Focus', break: 'Break', long: 'Long break'};
const PHASE_NEXT = {work: 'Time to focus', break: 'Time for a break', long: 'Time for a long break'};

/**
 * A stopwatch with laps, and a focus timer (Pomodoro: 25 minutes of work, 5 of rest, a long break
 * every fourth round). Both run in the Osmin service and show in the capsule while running.
 */
export class FocusWidget extends OsminWidget {
    static id = 'focus';
    static title = 'Focus';
    static iconName = 'alarm-symbolic';

    constructor(context) {
        super(context);
        this._focus = context.services.focus;
        this._activities = context.services.activities;
        this._events = context.events;
        this._settings = context.settings;
        this._activity = null;
        this._mode = null; // 'focus' | 'stopwatch'; chosen by the user, else what is running
    }

    start() {
        this._activity = new FocusActivity({focus: this._focus});
        this._focus.connectObject(
            'changed', () => this._onChanged(),
            'tick', () => this._activity.notifyChanged(),
            'phase', (_f, {phase}) => this._onPhase(phase),
            this);
        this._onChanged();
    }

    syncActivity() {
        this._onChanged();
    }

    _onChanged() {
        this._activity?.notifyChanged();
        if (this._activity) {
            if (this._focus.active && this._settings.get('activity-timer'))
                this._activities.start(this._activity);
            else
                this._activities.end('focus');
        }
        this._update();
    }

    _onPhase(phase) {
        this._events.emit({
            type: EventType.CUSTOM,
            icon: phase === 'work' ? 'alarm-symbolic' : 'preferences-system-time-symbolic',
            title: PHASE_NEXT[phase],
            description: phase === 'work' ? `${this._focus.config.work} minutes` : `${phase === 'long' ? this._focus.config.long : this._focus.config.short} minutes`,
            priority: Priority.HIGH,
            duration: 6000,
        });
        try {
            global.display.get_sound_player().play_from_theme('complete', 'Focus', null);
        } catch (e) {
            console.debug(`[osmin] focus sound failed: ${e.message}`);
        }
    }

    get _currentMode() {
        if (this._mode)
            return this._mode;
        if (this._focus.pomoState !== 'idle')
            return 'focus';
        if (this._focus.stopwatchState !== 'idle')
            return 'stopwatch';
        return 'focus';
    }

    createView() {
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-widget osmin-focus',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._tabs = new St.BoxLayout({style_class: 'osmin-timer-presets', x_expand: true});
        this._tabButtons = {};
        for (const [mode, label] of [['focus', 'Focus'], ['stopwatch', 'Stopwatch']]) {
            const button = createButton({
                label,
                styleClass: 'osmin-timer-chip',
                expand: true,
                onClick: () => {
                    this._mode = mode;
                    this._update();
                },
            });
            this._tabButtons[mode] = button;
            this._tabs.add_child(button);
        }
        root.add_child(this._tabs);
        this._time = new St.Label({style_class: 'osmin-timer-time osmin-focus-time', x_align: Clutter.ActorAlign.CENTER});
        root.add_child(this._time);
        this._caption = new St.Label({style_class: 'osmin-focus-caption', x_align: Clutter.ActorAlign.CENTER});
        root.add_child(this._caption);
        this._actions = new St.BoxLayout({style_class: 'osmin-timer-actions', x_expand: true});
        root.add_child(this._actions);
        this._focus.connectObject('tick', () => this._update(), this);
        return root;
    }

    onViewCreated() {
        this._update();
    }

    destroy() {
        this._focus.disconnectObject(this);
        if (this._activity)
            this._activities.end('focus');
        this._activity?.destroy();
        super.destroy();
    }

    _update() {
        if (!this._view)
            return;
        const f = this._focus;
        const mode = this._currentMode;
        for (const [id, button] of Object.entries(this._tabButtons)) {
            if (id === mode)
                button.add_style_pseudo_class('checked');
            else
                button.remove_style_pseudo_class('checked');
        }
        this._actions.destroy_all_children();
        // The main button has a label, the others only an icon (the column is narrow).
        const add = (label, iconName, handler, primary = false) => this._actions.add_child(createButton({
            label: primary || !iconName ? label : null,
            iconName: primary && !iconName ? null : iconName,
            styleClass: `osmin-timer-action${primary ? ' osmin-timer-primary' : ''}`,
            expand: primary,
            onClick: handler,
        }));
        if (mode === 'focus') {
            this._time.text = formatClock(f.pomoRemaining);
            this._caption.text = f.pomoState === 'idle'
                ? `${f.config.work} min focus · ${f.config.short} min break`
                : `${PHASE_NAMES[f.phase]} · round ${f.round} of ${f.config.every}${f.pomoState === 'paused' ? ' · paused' : ''}`;
            if (f.pomoState === 'idle') {
                add('Start', 'media-playback-start-symbolic', () => f.pomoStart(), true);
            } else {
                add(f.pomoState === 'running' ? 'Pause' : 'Resume', f.pomoState === 'running' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
                    () => (f.pomoState === 'running' ? f.pomoPause() : f.pomoStart()), true);
                add('Skip', 'media-skip-forward-symbolic', () => f.pomoSkip());
                add('Reset', 'view-refresh-symbolic', () => f.pomoReset());
            }
        } else {
            this._time.text = formatClock(f.stopwatchElapsed, {tenths: true});
            const laps = f.laps;
            this._caption.text = laps.length === 0 ? 'Stopwatch' : `Lap ${laps.length} · ${formatClock(laps[laps.length - 1], {tenths: true})}`;
            if (f.stopwatchState === 'idle') {
                add('Start', 'media-playback-start-symbolic', () => f.swStart(), true);
            } else {
                add(f.stopwatchState === 'running' ? 'Pause' : 'Resume', f.stopwatchState === 'running' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
                    () => (f.stopwatchState === 'running' ? f.swPause() : f.swStart()), true);
                if (f.stopwatchState === 'running')
                    add('Lap', null, () => f.swLap());
                add('Reset', 'view-refresh-symbolic', () => f.swReset());
            }
        }
    }
}
