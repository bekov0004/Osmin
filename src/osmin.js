import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ClockService} from './services/clockService.js';
import {MonitorService} from './services/monitorService.js';
import {WorkspaceService} from './services/workspaceService.js';
import {ClosedView} from './widgets/closedView.js';
import {HoverView} from './widgets/hoverView.js';
import {NotificationView} from './widgets/notificationView.js';
import {OpenView} from './widgets/openView.js';
import {animDuration, fadeIn, fadeOut} from './utils/animation.js';
import {
    HOVER_INTENT_MS, HOVER_LEAVE_MS, NOTIFY_MS, OPEN_LEAVE_MS, Preset, State, TOP_GAP,
} from './utils/constants.js';
import {getScaleFactor, scaled} from './utils/scale.js';
import {SignalTracker} from './utils/signals.js';
import {Timers} from './utils/timers.js';

/**
 * The island itself: owns the actor, the state machine and the services.
 * States: CLOSED -> HOVER -> OPEN, and NOTIFY as a transient state.
 */
export class Osmin {
    constructor() {
        this._state = null;
        this._signals = new SignalTracker();
        this._timers = new Timers();
        this._actor = null;
    }

    enable() {
        this._monitors = new MonitorService(() => this._relayout());
        this._clock = new ClockService(now => this._openView.clock.update(now));
        this._workspaces = new WorkspaceService(info => this._openView.workspace.update(info));

        this._buildActor();
        Main.layoutManager.addChrome(this._actor, {
            trackFullscreen: true,
        });

        this._signals.connect(St.ThemeContext.get_for_stage(global.stage),
            'notify::scale-factor', () => this._relayout());
        this._signals.connect(Main.layoutManager.panelBox, 'notify::height',
            () => this._relayout());

        this._openView.workspace.update(this._workspaces.getInfo());
        this._applyState(State.CLOSED, {animate: false});
    }

    destroy() {
        this._timers.destroy();
        this._signals.disconnectAll();
        this._clock?.destroy();
        this._workspaces?.destroy();
        this._monitors?.destroy();
        this._clock = this._workspaces = this._monitors = null;

        if (this._actor) {
            Main.layoutManager.removeChrome(this._actor);
            this._actor.destroy();
            this._actor = null;
        }
    }

    /** Shows a short message in the island, then collapses it again. */
    showNotification(text) {
        this._notifyView.setMessage(text);
        this._setState(State.NOTIFY);
        this._timers.set('notify', NOTIFY_MS, () => this._settle());
    }

    _buildActor() {
        this._actor = new St.Button({
            name: 'osmin',
            style_class: 'osmin',
            reactive: true,
            track_hover: true,
            can_focus: false,
            button_mask: St.ButtonMask.ONE,
        });

        this._content = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            x_expand: true,
            y_expand: true,
        });
        this._actor.set_child(this._content);

        this._closedView = new ClosedView();
        this._hoverView = new HoverView();
        this._notifyView = new NotificationView();
        this._openView = new OpenView({
            onClose: () => this._settle(),
            onTestNotification: () => this.showNotification('Test notification'),
        });
        this._views = {
            [State.CLOSED]: this._closedView,
            [State.HOVER]: this._hoverView,
            [State.OPEN]: this._openView,
            [State.NOTIFY]: this._notifyView,
        };
        for (const view of Object.values(this._views)) {
            view.opacity = 0;
            view.hide();
            this._content.add_child(view);
        }

        this._actor.connect('notify::hover', () => this._onHoverChanged());
        this._actor.connect('clicked', () => this._onClicked());
    }

    _onHoverChanged() {
        const hovered = this._actor.hover;
        this._timers.clear('hover');

        switch (this._state) {
        case State.CLOSED:
            if (hovered)
                this._timers.set('hover', HOVER_INTENT_MS, () => this._setState(State.HOVER));
            break;
        case State.HOVER:
            if (!hovered)
                this._timers.set('hover', HOVER_LEAVE_MS, () => this._setState(State.CLOSED));
            break;
        case State.OPEN:
            if (hovered)
                this._timers.clear('leave');
            else
                this._timers.set('leave', OPEN_LEAVE_MS, () => this._settle());
            break;
        }
    }

    _onClicked() {
        if (this._state === State.OPEN)
            return;
        this._timers.clear('notify');
        this._setState(State.OPEN);
    }

    /** Falls back to HOVER while the pointer is still over the island, else CLOSED. */
    _settle() {
        this._timers.clear('leave');
        this._setState(this._actor.hover && this._state !== State.OPEN
            ? State.HOVER : State.CLOSED);
    }

    _setState(state) {
        if (state === this._state)
            return;
        this._applyState(state, {animate: true});
    }

    _applyState(state, {animate}) {
        const previous = this._state;
        this._state = state;
        this._timers.clear('leave');
        if (state !== State.NOTIFY)
            this._timers.clear('notify');

        // Views: fade the old one out quickly, fade the new one in once the
        // island has started to grow.
        if (previous && previous !== state)
            fadeOut(this._views[previous], {duration: 110});
        const next = this._views[state];
        if (animate) {
            fadeIn(next, {
                duration: 240,
                delay: state === State.CLOSED ? 120 : 140,
            });
        } else {
            next.show();
            next.opacity = 255;
        }

        if (state === State.OPEN)
            this._clock.start();
        else
            this._clock.stop();

        this._actor.ease({
            ...this._geometryFor(state),
            duration: animate ? animDuration(Preset[state].duration) : 0,
            mode: Preset[state].mode,
        });
    }

    _geometryFor(state) {
        const monitor = this._monitors.getMonitor();
        const width = scaled(Preset[state].width);
        const height = scaled(Preset[state].height);
        return {
            x: monitor.x + Math.round((monitor.width - width) / 2),
            y: this._monitors.getTopEdge() + scaled(TOP_GAP),
            width,
            height,
        };
    }

    /** Re-applies the current geometry without animation (monitor/scale changes). */
    _relayout() {
        if (!this._actor)
            return;
        const geometry = this._geometryFor(this._state);
        this._actor.remove_all_transitions();
        this._actor.set_position(geometry.x, geometry.y);
        this._actor.set_size(geometry.width, geometry.height);
    }
}
