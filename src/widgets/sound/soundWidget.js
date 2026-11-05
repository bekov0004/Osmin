import Clutter from 'gi://Clutter';
import Gvc from 'gi://Gvc';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {createButton} from '../../ui/button.js';
import {HorizontalSlider} from '../../ui/horizontalSlider.js';
import {menuCard, menuDivider, menuHeader, menuRow, switchRow} from '../../ui/menuKit.js';
import {OsminWidget} from '../widget.js';

const MAX_APPS = 6;

/**
 * Sound: the volume and the output (speakers, headphones ...), a microphone mute, and the volume
 * of each application on its own (a call quieter than the music). It talks to the sound system
 * through the same library GNOME's own volume menu uses.
 */
export class SoundWidget extends OsminWidget {
    static id = 'sound';
    static title = 'Sound';
    static iconName = 'audio-speakers-symbolic';
    static menuNative = true;

    constructor(context) {
        super(context);
        this._mixer = null;
        this._ready = false;
        this._apps = new Map(); // stream id -> {row, slider, mute}
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-sound osmin-menu-page', x_expand: true});

        root.add_child(menuHeader('Output'));
        const output = menuCard();
        this._outputRow = menuRow({
            title: '…', subtitle: 'Click to use the next output',
            control: new St.Icon({icon_name: 'audio-speakers-symbolic', style_class: 'osmin-tool-icon'}),
            onClick: () => this._nextOutput(),
        });
        output.add_child(this._outputRow.row);
        output.add_child(menuDivider());

        const master = new St.BoxLayout({style_class: 'osmin-card-row osmin-sound-row', x_expand: true});
        this._muteButton = createButton({iconName: 'audio-volume-high-symbolic', styleClass: 'osmin-sound-mute', onClick: () => this._toggleMute()});
        master.add_child(this._muteButton);
        this._slider = new HorizontalSlider({min: 0, max: 100, value: 0, onChange: value => this._setVolume(value)});
        this._slider.y_align = Clutter.ActorAlign.CENTER;
        master.add_child(this._slider);
        this._percent = new St.Label({text: '', style_class: 'osmin-sound-percent', y_align: Clutter.ActorAlign.CENTER});
        master.add_child(this._percent);
        output.add_child(master);
        output.add_child(menuDivider());
        this._micRow = switchRow({title: 'Microphone', subtitle: 'Turn off to mute it', state: true, onToggle: () => this._toggleMic()});
        output.add_child(this._micRow.row);
        root.add_child(output);

        this._appsHeader = menuHeader('Applications');
        root.add_child(this._appsHeader);
        this._list = menuCard();
        root.add_child(this._list);
        this._scroll = this._list; // shown only while an application makes sound
        this._note = new St.Label({text: '', style_class: 'osmin-card-hint', x_align: Clutter.ActorAlign.CENTER});
        root.add_child(this._note);

        this._connect();
        return root;
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
            this);
        this._mixer.open();
    }

    _onState() {
        this._ready = this._mixer.get_state() === Gvc.MixerControlState.READY;
        this._update();
    }

    _update() {
        if (!this._view)
            return;
        if (!this._ready) {
            this._note.text = this._mixer?.get_state() === Gvc.MixerControlState.FAILED ? 'The sound system is not available' : 'Connecting to the sound system…';
            this._note.visible = true;
            this._scroll.visible = this._appsHeader.visible = false;
            return;
        }
        this._note.visible = false;
        const sink = this._mixer.get_default_sink();
        const max = this._mixer.get_vol_max_norm();
        if (sink) {
            this._slider.max = max;
            this._slider.value = sink.volume;
            this._percent.text = sink.is_muted ? 'muted' : `${Math.round(100 * sink.volume / max)}%`;
            this._outputRow.title.text = sink.description ?? sink.name ?? 'Output';
            this._muteButton.get_child().get_first_child().icon_name = sink.is_muted || sink.volume === 0
                ? 'audio-volume-muted-symbolic' : sink.volume < max / 2 ? 'audio-volume-medium-symbolic' : 'audio-volume-high-symbolic';
            sink.disconnectObject(this);
            sink.connectObject('notify::volume', () => this._update(), 'notify::is-muted', () => this._update(), this);
        }
        const source = this._mixer.get_default_source();
        this._micRow.set(!!source && !source.is_muted);
        this._rebuildApps(max);
    }

    _rebuildApps(max) {
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
            if (!app) {
                const row = new St.BoxLayout({style_class: 'osmin-sound-app osmin-card-row', x_expand: true});
                const icon = new St.Icon({icon_name: stream.icon_name || 'audio-x-generic-symbolic', style_class: 'osmin-sound-app-icon', y_align: Clutter.ActorAlign.CENTER});
                row.add_child(icon);
                const name = new St.Label({text: stream.name || 'Application', style_class: 'osmin-sound-app-name', y_align: Clutter.ActorAlign.CENTER});
                name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                row.add_child(name);
                const slider = new HorizontalSlider({min: 0, max, value: stream.volume, onChange: value => {
                    stream.volume = Math.round(value);
                    stream.push_volume();
                }});
                slider.y_align = Clutter.ActorAlign.CENTER;
                row.add_child(slider);
                this._list.add_child(row);
                app = {row, slider};
                this._apps.set(stream.id, app);
                stream.connectObject('notify::volume', () => {
                    app.slider.value = stream.volume;
                }, this);
            }
            app.slider.max = max;
            app.slider.value = stream.volume;
        }
        this._scroll.visible = this._appsHeader.visible = streams.length > 0;
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

    _toggleMute() {
        const sink = this._mixer?.get_default_sink();
        sink?.change_is_muted(!sink.is_muted);
    }

    _toggleMic() {
        const source = this._mixer?.get_default_source();
        source?.change_is_muted(!source.is_muted);
    }

    /** The next output (speakers, headphones, HDMI ...) becomes the one in use. */
    _nextOutput() {
        const sinks = this._mixer?.get_sinks() ?? [];
        if (sinks.length < 2)
            return;
        const current = this._mixer.get_default_sink();
        const index = sinks.findIndex(s => s.id === current?.id);
        this._mixer.set_default_sink(sinks[(index + 1) % sinks.length]);
    }

    destroy() {
        this._mixer?.disconnectObject(this);
        this._mixer?.get_default_sink()?.disconnectObject(this);
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
