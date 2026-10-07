import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {TimerState, formatRemaining} from '../../services/timerService.js';
import {createButton} from '../../ui/button.js';
import {LiveActivity, createCompactParts} from '../../ui/liveActivity.js';

/** Timer: ongoing while it runs (or waits to be dismissed); peeks when it ends. */
export class TimerActivity extends LiveActivity {
    constructor({timer, onDismiss}) {
        super({id: 'timer', widgetId: 'timer', compactPriority: 30});
        this._timer = timer;
        this._onDismiss = onDismiss;
    }

    get title() {
        return this._timer.state === TimerState.DONE ? 'Timer ended' : 'Timer';
    }

    get text() {
        switch (this._timer.state) {
        case TimerState.DONE:
            return 'DONE';
        case TimerState.PAUSED:
            return `${formatRemaining(this._timer.remaining)} ‖`;
        default:
            return formatRemaining(this._timer.remaining);
        }
    }

    get peekSize() {
        return {width: 390, height: 62};
    }

    createCompactParts() {
        return createCompactParts(this, 'alarm-symbolic', () => this.text);
    }

    createPeekView() {
        const box = new St.BoxLayout({
            style_class: 'osmin-peek',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(new St.Bin({
            style_class: 'osmin-peek-badge',
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'alarm-symbolic', style_class: 'osmin-peek-badge-icon'}),
        }));
        const texts = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'osmin-peek-texts',
        });
        const title = new St.Label({style_class: 'osmin-peek-title'});
        const subtitle = new St.Label({style_class: 'osmin-peek-subtitle'});
        texts.add_child(title);
        texts.add_child(subtitle);
        box.add_child(texts);

        // +1 min, pause / resume, stop.
        const controls = new St.BoxLayout({style_class: 'osmin-peek-controls', y_align: Clutter.ActorAlign.CENTER});
        const plus = createButton({
            label: '+1m',
            styleClass: 'osmin-peek-button osmin-peek-plus',
            onClick: () => this._timer.addTime(60 * 1000),
        });
        const toggle = createButton({
            iconName: 'media-playback-pause-symbolic',
            styleClass: 'osmin-peek-button',
            onClick: () => {
                switch (this._timer.state) {
                case TimerState.RUNNING:
                    this._timer.pause();
                    break;
                case TimerState.PAUSED:
                    this._timer.resume();
                    break;
                default:
                    this._timer.start();
                }
            },
        });
        const stop = createButton({
            iconName: 'media-playback-stop-symbolic',
            styleClass: 'osmin-peek-button',
            onClick: () => this._onDismiss(),
        });
        for (const button of [plus, toggle, stop])
            controls.add_child(button);
        box.add_child(controls);

        const toggleIcon = toggle.get_child().get_first_child();
        const stopIcon = stop.get_child().get_first_child();
        const refresh = () => {
            const done = this._timer.state === TimerState.DONE;
            title.text = this.title;
            subtitle.text = done ? 'DONE' : this.text;
            // A finished timer cannot be paused: only "+1m" (a new minute) and close remain.
            toggle.visible = !done;
            toggleIcon.icon_name = this._timer.state === TimerState.RUNNING
                ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
            stopIcon.icon_name = done ? 'window-close-symbolic' : 'media-playback-stop-symbolic';
        };
        this.connectObject('changed', refresh, box);
        box.connect('destroy', () => this.disconnectObject(box));
        refresh();
        return box;
    }
}
