import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gvc from 'gi://Gvc';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {HorizontalSlider} from '../../ui/horizontalSlider.js';
import {checkRow, collapsible, dropdown, menuCard, menuDivider} from '../../ui/menuKit.js';
import {OsminWidget} from '../widget.js';

const MAX_APPS = 8;

/**
 * Volume mixer: the output with its volume, the sound of system events, the microphone, and every
 * application on its own (volume up to the amplified maximum, the device it plays on, a reset and a
 * mute), through the same library GNOME's own volume menu uses.
 */
export class SoundWidget extends OsminWidget {
    static id = 'sound';
    static title = 'Volume mixer';
    static iconName = 'audio-volume-high-symbolic';
    static menuNative = true;

    constructor(context) {
        super(context);
        this._mixer = null;
        this._ready = false;
        this._apps = new Map(); // stream id -> {row, slider, ...}
        try {
            this._sound = new Gio.Settings({schema_id: 'org.gnome.desktop.sound'});
        } catch (e) {
            this._sound = null;
        }
        try {
            this._keys = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.media-keys'});
        } catch (e) {
            this._keys = null;
        }
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-sound osmin-menu-page', x_expand: true});
        const card = menuCard();
        card.add_style_class_name('osmin-bigcard');
        root.add_child(card);

        // Output: the device and the volume.
        this._outputPick = dropdown({items: [], onPick: id => this._setOutput(id)});
        card.add_child(this._labelled('audio-speakers-symbolic', 'Output', this._outputPick));
        const master = new St.BoxLayout({style_class: 'osmin-sound-row', x_expand: true});
        this._muteIcon = new St.Icon({icon_name: 'audio-volume-high-symbolic', style_class: 'osmin-meter-icon', y_align: Clutter.ActorAlign.CENTER});
        const muteButton = new St.Button({reactive: true, child: this._muteIcon, y_align: Clutter.ActorAlign.CENTER});
        muteButton.connect('clicked', () => this._toggleMute());
        master.add_child(muteButton);
        this._slider = new HorizontalSlider({min: 0, max: 100, value: 0, onChange: value => this._setVolume(value)});
        this._slider.y_align = Clutter.ActorAlign.CENTER;
        master.add_child(this._slider);
        this._percent = new St.Label({text: '', style_class: 'osmin-sound-percent', y_align: Clutter.ActorAlign.CENTER});
        master.add_child(this._percent);
        card.add_child(master);

        // System sounds.
        this._eventsPick = dropdown({items: [{id: 'on', label: 'Play'}, {id: 'off', label: 'Silent'}],
            current: this._sound?.get_boolean('event-sounds') ? 'on' : 'off', onPick: id => this._sound?.set_boolean('event-sounds', id === 'on')});
        card.add_child(this._labelled('preferences-system-notifications-symbolic', 'System sounds', this._eventsPick));

        // Microphone.
        this._micPick = dropdown({items: [], onPick: id => this._setInput(id)});
        card.add_child(this._labelled('audio-input-microphone-symbolic', 'Microphone', this._micPick));
        const mic = new St.BoxLayout({style_class: 'osmin-sound-row', x_expand: true});
        this._micIcon = new St.Icon({icon_name: 'audio-input-microphone-symbolic', style_class: 'osmin-meter-icon', y_align: Clutter.ActorAlign.CENTER});
        const micButton = new St.Button({reactive: true, child: this._micIcon, y_align: Clutter.ActorAlign.CENTER});
        micButton.connect('clicked', () => this._toggleMic());
        mic.add_child(micButton);
        this._micSlider = new HorizontalSlider({min: 0, max: 100, value: 0, onChange: value => this._setMicVolume(value)});
        this._micSlider.y_align = Clutter.ActorAlign.CENTER;
        mic.add_child(this._micSlider);
        this._micPercent = new St.Label({text: '', style_class: 'osmin-sound-percent', y_align: Clutter.ActorAlign.CENTER});
        mic.add_child(this._micPercent);
        card.add_child(mic);

        this._appsDivider = menuDivider();
        card.add_child(this._appsDivider);
        this._list = new St.BoxLayout({vertical: true, x_expand: true});
        card.add_child(this._list);
        this._note = new St.Label({text: '', style_class: 'osmin-hint'});
        card.add_child(this._note);
        card.add_child(menuDivider());

        const options = collapsible('Options', {open: false});
        card.add_child(options.actor);
        if (this._keys) {
            this._fine = checkRow({title: 'Use finer volume steps', subtitle: 'Turns the volume keys into smaller steps.', state: this._keys.get_int('volume-step') <= 2,
                onToggle: on => this._keys.set_int('volume-step', on ? 2 : 6)});
            options.body.add_child(this._fine.row);
        }
        this._amplify = checkRow({title: 'Allow volume above 100%', subtitle: 'Louder than the normal maximum, for quiet recordings.',
            state: !!this._sound?.get_boolean('allow-volume-above-100-percent'), onToggle: on => this._sound?.set_boolean('allow-volume-above-100-percent', on)});
        if (this._sound)
            options.body.add_child(this._amplify.row);

        this._connect();
        return root;
    }

    /** A label with an icon on the left and a drop-down on the right. */
    _labelled(icon, text, pick) {
        const row = new St.BoxLayout({style_class: 'osmin-value-row osmin-labelled', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        row.add_child(new St.Icon({icon_name: icon, style_class: 'osmin-meter-icon', y_align: Clutter.ActorAlign.CENTER}));
        row.add_child(new St.Label({text, style_class: 'osmin-value-label', y_align: Clutter.ActorAlign.CENTER}));
        pick.actor.x_expand = true;
        row.add_child(pick.actor);
        return row;
    }

    _connect() {
        if (this._mixer)
            return;
        this._mixer = new Gvc.MixerControl({name: 'Osmin'});
        this._mixer.connectObject(
            'state-changed', () => this._onState(),
            'default-sink-changed', () => this._update(),
            'default-source-changed', () => this._update(),
            'stream-added', () => this._update(),
            'stream-removed', () => this._update(),
            'output-added', () => this._update(),
            'output-removed', () => this._update(),
            'input-added', () => this._update(),
            'input-removed', () => this._update(),
            this);
        this._mixer.open();
    }

    _onState() {
        this._ready = this._mixer.get_state() === Gvc.MixerControlState.READY;
        this._update();
    }

    _maxFor(max) {
        return this._sound?.get_boolean('allow-volume-above-100-percent') ? this._mixer.get_vol_max_amplified() : max;
    }

    _update() {
        if (!this._view)
            return;
        if (!this._ready) {
            this._note.text = this._mixer?.get_state() === Gvc.MixerControlState.FAILED ? 'The sound system is not available' : 'Connecting to the sound system…';
            return;
        }
        this._note.text = '';
        const sink = this._mixer.get_default_sink();
        const norm = this._mixer.get_vol_max_norm();
        const max = this._maxFor(norm);
        if (sink) {
            this._slider.max = max;
            this._slider.value = sink.volume;
            this._percent.text = sink.is_muted ? 'muted' : `${Math.round(100 * sink.volume / norm)}%`;
            this._muteIcon.icon_name = sink.is_muted || sink.volume === 0 ? 'audio-volume-muted-symbolic'
                : sink.volume < norm / 2 ? 'audio-volume-medium-symbolic' : 'audio-volume-high-symbolic';
            sink.disconnectObject(this);
            sink.connectObject('notify::volume', () => this._update(), 'notify::is-muted', () => this._update(), this);
            this._sinks = this._mixer.get_sinks();
            this._outputPick.setItems(this._sinks.map(s => ({id: String(s.id), label: s.description ?? s.name})));
            this._outputPick.setCurrent(String(sink.id));
        }
        const source = this._mixer.get_default_source();
        if (source) {
            this._micSlider.max = norm;
            this._micSlider.value = source.volume;
            this._micPercent.text = source.is_muted ? 'muted' : `${Math.round(100 * source.volume / norm)}%`;
            this._micIcon.icon_name = source.is_muted ? 'microphone-disabled-symbolic' : 'audio-input-microphone-symbolic';
            this._sources = this._mixer.get_sources().filter(s => !/monitor/i.test(s.name ?? ''));
            this._micPick.setItems(this._sources.map(s => ({id: String(s.id), label: s.description ?? s.name})));
            this._micPick.setCurrent(String(source.id));
            source.disconnectObject(this);
            source.connectObject('notify::volume', () => this._update(), 'notify::is-muted', () => this._update(), this);
        }
        this._rebuildApps(norm, max);
    }

    _rebuildApps(norm, max) {
        const streams = this._mixer.get_sink_inputs().filter(s => !s.is_event_stream).slice(0, MAX_APPS);
        const ids = new Set(streams.map(s => s.id));
        for (const [id, app] of this._apps) {
            if (!ids.has(id)) {
                app.row.destroy();
                this._apps.delete(id);
            }
        }
        for (const stream of streams) {
            let app = this._apps.get(stream.id);
            if (!app)
                app = this._addApp(stream, norm, max);
            app.slider.max = max;
            app.slider.value = stream.volume;
            this._showApp(app, stream, norm);
        }
        this._list.visible = this._appsDivider.visible = streams.length > 0;
        if (streams.length === 0)
            this._note.text = 'Applications that play sound appear here.';
    }

    _addApp(stream, norm, max) {
        const row = new St.BoxLayout({style_class: 'osmin-app-line', x_expand: true});
        const icon = new St.Icon({icon_name: stream.icon_name || 'audio-x-generic-symbolic', style_class: 'osmin-app-icon', y_align: Clutter.ActorAlign.CENTER});
        row.add_child(icon);
        const body = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'osmin-app-body'});
        const head = new St.BoxLayout({x_expand: true});
        const name = new St.Label({text: stream.name || 'Application', style_class: 'osmin-value-label osmin-value-strong', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        head.add_child(name);
        const device = dropdown({items: [], onPick: sinkId => this._moveStream(stream, sinkId)});
        device.actor.width = 150;
        head.add_child(device.actor);
        body.add_child(head);
        const line = new St.BoxLayout({x_expand: true, style_class: 'osmin-app-slider'});
        const slider = new HorizontalSlider({min: 0, max, value: stream.volume, onChange: value => {
            stream.volume = Math.round(value);
            stream.push_volume();
        }});
        slider.y_align = Clutter.ActorAlign.CENTER;
        line.add_child(slider);
        const percent = new St.Label({text: '', style_class: 'osmin-sound-percent', y_align: Clutter.ActorAlign.CENTER});
        line.add_child(percent);
        const reset = new St.Button({style_class: 'osmin-app-reset', reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'view-refresh-symbolic', icon_size: 13})});
        reset.connect('clicked', () => {
            stream.volume = norm;
            stream.push_volume();
        });
        line.add_child(reset);
        const mute = new St.Button({style_class: 'osmin-app-reset', reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER});
        const muteIcon = new St.Icon({icon_name: 'audio-volume-high-symbolic', icon_size: 14});
        mute.set_child(muteIcon);
        mute.connect('clicked', () => stream.change_is_muted(!stream.is_muted));
        line.add_child(mute);
        body.add_child(line);
        row.add_child(body);
        this._list.add_child(row);
        const app = {row, slider, percent, reset, muteIcon, device};
        this._apps.set(stream.id, app);
        stream.connectObject('notify::volume', () => {
            app.slider.value = stream.volume;
            this._showApp(app, stream, this._mixer.get_vol_max_norm());
        }, 'notify::is-muted', () => this._showApp(app, stream, this._mixer.get_vol_max_norm()), this);
        return app;
    }

    /** The percent (orange with a bolt above 100%), the reset and the mute icon of one application. */
    _showApp(app, stream, norm) {
        const percent = Math.round(100 * stream.volume / norm);
        const boosted = percent > 100;
        app.percent.text = stream.is_muted ? 'muted' : `${boosted ? '⚡' : ''}${percent}%`;
        app.percent.style = boosted ? 'color: #ff9f0a;' : '';
        app.reset.visible = percent !== 100;
        app.muteIcon.icon_name = stream.is_muted ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic';
        const sinks = this._sinks ?? [];
        app.device.setItems([{id: 'default', label: 'Default'}, ...sinks.map(s => ({id: String(s.id), label: s.description ?? s.name}))]);
        app.device.setCurrent('default');
    }

    /** Moves one application's sound to another output (PipeWire / PulseAudio). */
    _moveStream(stream, sinkId) {
        const sink = sinkId === 'default' ? this._mixer.get_default_sink() : this._sinks.find(s => String(s.id) === sinkId);
        if (!sink || stream.index === undefined)
            return;
        GLib.spawn_async(null, ['pactl', 'move-sink-input', String(stream.index), sink.name], null, GLib.SpawnFlags.SEARCH_PATH, null);
    }

    _setOutput(id) {
        const sink = this._sinks?.find(s => String(s.id) === id);
        if (sink)
            this._mixer.set_default_sink(sink);
    }

    _setInput(id) {
        const source = this._sources?.find(s => String(s.id) === id);
        if (source)
            this._mixer.set_default_source(source);
    }

    _setVolume(value) {
        const sink = this._mixer?.get_default_sink();
        if (!sink)
            return;
        sink.volume = Math.round(value);
        sink.push_volume();
        if (sink.is_muted && value > 0)
            sink.change_is_muted(false);
    }

    _setMicVolume(value) {
        const source = this._mixer?.get_default_source();
        if (!source)
            return;
        source.volume = Math.round(value);
        source.push_volume();
    }

    _toggleMute() {
        const sink = this._mixer?.get_default_sink();
        sink?.change_is_muted(!sink.is_muted);
    }

    _toggleMic() {
        const source = this._mixer?.get_default_source();
        source?.change_is_muted(!source.is_muted);
    }

    destroy() {
        this._mixer?.disconnectObject(this);
        this._mixer?.get_default_sink()?.disconnectObject(this);
        this._mixer?.get_default_source()?.disconnectObject(this);
        for (const stream of this._mixer?.get_sink_inputs?.() ?? [])
            stream.disconnectObject(this);
        try {
            this._mixer?.close();
        } catch (e) {
            // never opened
        }
        this._mixer = null;
        super.destroy();
    }
}
