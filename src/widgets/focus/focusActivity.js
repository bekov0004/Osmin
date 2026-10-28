import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {formatClock} from '../../services/focusService.js';
import {createButton} from '../../ui/button.js';
import {LiveActivity, createCompactParts} from '../../ui/liveActivity.js';

const PHASE_NAMES = {work: 'Focus', break: 'Break', long: 'Long break'};

/** The focus timer / stopwatch in the capsule while one of them runs. */
export class FocusActivity extends LiveActivity {
    constructor({focus}) {
        super({id: 'focus', widgetId: 'focus', compactPriority: 25});
        this._focus = focus;
    }

    get title() {
        return this._focus.pomoState !== 'idle' ? PHASE_NAMES[this._focus.phase] : 'Stopwatch';
    }

    get text() {
        const f = this._focus;
        if (f.pomoState !== 'idle')
            return `${formatClock(f.pomoRemaining)}${f.pomoState === 'paused' ? ' ‖' : ''}`;
        return `${formatClock(f.stopwatchElapsed)}${f.stopwatchState === 'paused' ? ' ‖' : ''}`;
    }

    get icon() {
        return this._focus.pomoState !== 'idle' && this._focus.phase !== 'work'
            ? 'preferences-system-time-symbolic' : 'alarm-symbolic';
    }

    get peekSize() {
        return {width: 340, height: 62};
    }

    createCompactParts() {
        return createCompactParts(this, 'alarm-symbolic', () => this.text);
    }

    createPeekView() {
        const box = new St.BoxLayout({style_class: 'osmin-peek', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        box.add_child(new St.Bin({
            style_class: 'osmin-peek-badge',
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'alarm-symbolic', style_class: 'osmin-peek-badge-icon'}),
        }));
        const texts = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'osmin-peek-texts'});
        const title = new St.Label({style_class: 'osmin-peek-title'});
        const subtitle = new St.Label({style_class: 'osmin-peek-subtitle'});
        texts.add_child(title);
        texts.add_child(subtitle);
        box.add_child(texts);
        const controls = new St.BoxLayout({style_class: 'osmin-peek-controls', y_align: Clutter.ActorAlign.CENTER});
        const toggle = createButton({
            iconName: 'media-playback-pause-symbolic',
            styleClass: 'osmin-peek-button',
            onClick: () => {
                const f = this._focus;
                if (f.pomoState !== 'idle')
                    f.pomoState === 'running' ? f.pomoPause() : f.pomoStart();
                else
                    f.stopwatchState === 'running' ? f.swPause() : f.swStart();
            },
        });
        controls.add_child(toggle);
        box.add_child(controls);
        const icon = toggle.get_child().get_first_child();
        const refresh = () => {
            title.text = this.title;
            subtitle.text = this.text;
            const f = this._focus;
            const running = f.pomoState !== 'idle' ? f.pomoState === 'running' : f.stopwatchState === 'running';
            icon.icon_name = running ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        };
        this.connectObject('changed', refresh, box);
        box.connect('destroy', () => this.disconnectObject(box));
        refresh();
        return box;
    }
}
