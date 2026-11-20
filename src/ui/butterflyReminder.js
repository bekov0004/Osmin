import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {animDuration} from '../utils/animation.js';
import {scaled} from '../utils/scale.js';
import {Butterfly} from './butterfly.js';

const SIZE = [176, 148];        // css px of the big butterfly
const FLY_MS = 1500;
const BACK_MS = 1000;
const BOB_MS = 2600;

const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = t => 1 - (1 - t) ** 3;

/**
 * A reminder of the butterfly: it flies out of the capsule, growing as it comes down, hovers at the top of the
 * screen beating its wings, and shows the text under it with "In 10 min" and "Done". Then it flies back, small again,
 * into the capsule. Shown over everything, also over an app in full screen.
 */
export class ButterflyReminder {
    /**
     * @param {{reminder: object, from: {x: number, y: number, width: number, height: number}, monitor: object,
     *          onSnooze: () => void, onDone: () => void, onFinished: () => void, sound?: boolean}} options
     */
    constructor({reminder, from, monitor, onSnooze, onDone, onFinished, sound = true}) {
        this._reminder = reminder;
        this._from = from;
        this._monitor = monitor;
        this._onSnooze = onSnooze;
        this._onDone = onDone;
        this._onFinished = onFinished;
        this._sound = sound;
        this._timelines = [];
        this._finished = false;
    }

    show() {
        const [w, h] = SIZE.map(v => scaled(v));
        this._w = w;
        this._h = h;
        this._layer = new St.Widget({reactive: false, x: this._monitor.x, y: this._monitor.y, width: this._monitor.width, height: this._monitor.height});
        Main.layoutManager.addTopChrome(this._layer);
        // a full-screen app would be shown past the shell otherwise
        global.compositor.disable_unredirect?.();
        this._unredirectOff = true;

        this._fly = new St.Widget({width: w, height: h, layout_manager: new Clutter.BinLayout()});
        this._fly.set_pivot_point(0.5, 0.5);
        this._butterfly = new Butterfly();
        this._butterfly.set_size(w, h);
        this._butterfly.style = `width: ${w}px; height: ${h}px;`;
        this._fly.add_child(this._butterfly);
        this._layer.add_child(this._fly);

        this._card = this._makeCard();
        this._card.opacity = 0;
        this._layer.add_child(this._card);

        // from the capsule's butterfly to the top of the screen, growing
        const start = {x: this._from.x + this._from.width / 2 - this._monitor.x, y: this._from.y + this._from.height / 2 - this._monitor.y};
        this._target = {x: this._monitor.width / 2, y: scaled(40) + h / 2};
        const startScale = Math.max(0.12, this._from.width / w);
        this._place(start.x, start.y, startScale, 0);
        this._butterfly.flutter(260);
        if (this._sound)
            global.display.get_sound_player?.()?.play_from_theme('complete', this._reminder.text || 'Reminder', null);

        this._animate(FLY_MS, t => {
            const p = easeInOut(t);
            const sway = Math.sin(t * Math.PI * 2.2) * scaled(70) * (1 - t);
            const x = start.x + (this._target.x - start.x) * p + sway;
            const y = start.y + (this._target.y - start.y) * p;
            this._place(x, y, startScale + (1 - startScale) * easeOut(t), Math.sin(t * Math.PI * 3) * 14 * (1 - t));
        }, () => this._hover());
    }

    _place(cx, cy, scale, angle) {
        this._fly.set_position(Math.round(cx - this._w / 2), Math.round(cy - this._h / 2));
        this._fly.set_scale(scale, scale);
        this._fly.rotation_angle_z = angle;
    }

    /** It stays, beating its wings slowly and bobbing; the text comes. */
    _hover() {
        this._butterfly.flutter(900);
        this._card.set_position(Math.round(this._target.x - this._card.width / 2), Math.round(this._target.y + this._h / 2 + scaled(6)));
        this._card.translation_y = scaled(10);
        this._card.ease({opacity: 255, translation_y: 0, duration: animDuration(320), mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        this._bob = this._animate(BOB_MS, t => {
            this._place(this._target.x, this._target.y + Math.sin(t * Math.PI * 2) * scaled(6), 1, Math.sin(t * Math.PI * 2) * 3);
        }, null, -1);
    }

    _makeCard() {
        const card = new St.BoxLayout({vertical: true, style_class: 'osmin-bfr-card', reactive: true});
        const time = new St.Label({text: this._reminder.time ?? '', style_class: 'osmin-bfr-time', x_align: Clutter.ActorAlign.CENTER});
        card.add_child(time);
        const text = new St.Label({text: this._reminder.text || 'Reminder', style_class: 'osmin-bfr-text', x_align: Clutter.ActorAlign.CENTER});
        text.clutter_text.line_wrap = true;
        text.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        text.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        text.clutter_text.set_justify?.(true);
        text.clutter_text.line_alignment = Pango.Alignment.CENTER;
        card.add_child(text);
        const buttons = new St.BoxLayout({style_class: 'osmin-bfr-buttons', x_align: Clutter.ActorAlign.CENTER});
        const later = new St.Button({label: 'In 10 min', style_class: 'osmin-bfr-button', can_focus: true, reactive: true, track_hover: true});
        const done = new St.Button({label: 'Done', style_class: 'osmin-bfr-button osmin-bfr-done', can_focus: true, reactive: true, track_hover: true});
        later.connect('clicked', () => this.dismiss('snooze'));
        done.connect('clicked', () => this.dismiss('done'));
        buttons.add_child(later);
        buttons.add_child(done);
        card.add_child(buttons);
        // as wide as the text wants, between 260 and 460 px; a long text wraps
        const [, natural] = text.get_preferred_width(-1);
        card.set_width(Math.min(Math.max(natural + scaled(48), scaled(260)), scaled(460)));
        return card;
    }

    /** "In 10 min" or "Done": the text goes, the butterfly flies back into the capsule. */
    dismiss(kind = 'done') {
        if (this._leaving)
            return;
        this._leaving = true;
        if (kind === 'snooze')
            this._onSnooze?.();
        else
            this._onDone?.();
        this._card.ease({opacity: 0, translation_y: scaled(8), duration: animDuration(200), mode: Clutter.AnimationMode.EASE_IN_QUAD});
        this._bob?.stop();
        this._butterfly.flutter(240);
        const from = {x: this._fly.x + this._w / 2, y: this._fly.y + this._h / 2};
        const back = {x: this._from.x + this._from.width / 2 - this._monitor.x, y: this._from.y + this._from.height / 2 - this._monitor.y};
        const endScale = Math.max(0.12, this._from.width / this._w);
        this._animate(BACK_MS, t => {
            const p = easeInOut(t);
            const sway = Math.sin(t * Math.PI * 2) * scaled(40) * (1 - t);
            this._place(from.x + (back.x - from.x) * p + sway, from.y + (back.y - from.y) * p, 1 + (endScale - 1) * p, -Math.sin(t * Math.PI * 2) * 10 * (1 - t));
        }, () => this._finish());
    }

    _animate(ms, frame, done, repeat = 0) {
        const duration = animDuration(ms);
        if (!duration) {
            frame(1);
            if (done)
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    done();
                    return GLib.SOURCE_REMOVE;
                });
            return null;
        }
        const timeline = new Clutter.Timeline({actor: this._layer, duration, repeat_count: repeat});
        timeline.connect('new-frame', tl => frame(tl.get_progress()));
        if (done)
            timeline.connect('completed', () => done());
        this._timelines.push(timeline);
        timeline.start();
        return timeline;
    }

    _finish() {
        if (this._finished)
            return;
        this._finished = true;
        for (const timeline of this._timelines)
            timeline.stop();
        this._timelines = [];
        if (this._unredirectOff)
            global.compositor.enable_unredirect?.();
        this._unredirectOff = false;
        this._layer?.destroy();
        this._layer = null;
        this._onFinished?.();
    }

    destroy() {
        this._finish();
    }
}
