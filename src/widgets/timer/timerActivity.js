import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {TimerState, formatRemaining} from '../../services/timerService.js';
import {createButton} from '../../ui/button.js';
import {LiveActivity, createCompactRow} from '../../ui/liveActivity.js';

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
        return {width: 320, height: 62};
    }

    createCompactView() {
        return createCompactRow(this, 'alarm-symbolic', () => this.text);
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

        const dismiss = createButton({
            iconName: 'window-close-symbolic',
            styleClass: 'osmin-close-button',
            onClick: () => this._onDismiss(),
        });
        dismiss.y_align = Clutter.ActorAlign.CENTER;
        box.add_child(dismiss);

        const refresh = () => {
            title.text = this.title;
            subtitle.text = this._timer.state === TimerState.DONE ? 'DONE' : this.text;
        };
        this.connectObject('changed', refresh, box);
        box.connect('destroy', () => this.disconnectObject(box));
        refresh();
        return box;
    }
}
