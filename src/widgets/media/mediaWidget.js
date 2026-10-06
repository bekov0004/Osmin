import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {createButton} from '../../ui/button.js';
import {PlaybackStatus} from '../../services/mediaService.js';
import {OsminWidget} from '../widget.js';
import {Priority} from '../../utils/events.js';
import {MediaActivity} from './mediaActivity.js';

const TICK_MS = 500;

function formatDuration(us) {
    const total = Math.max(0, Math.floor(us / 1e6));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Media player card for any MPRIS player: artwork, title, artist, progress
 * (click to seek), previous / play-pause / next.
 */
export class MediaWidget extends OsminWidget {
    static id = 'media';
    static title = 'Media';
    static iconName = 'audio-x-generic-symbolic';

    constructor(context) {
        super(context);
        this._media = context.services.media;
        this._artwork = context.services.artwork;
        this._activities = context.services.activities;
        this._activity = null;
        this._tickId = 0;
        this._shown = false;
        this._artUrl = null;
        this._player = null;
        this._connected = false;
    }

    /** Publishes the Live Activity: ongoing while playing, peeks on start / track change. */
    start() {
        this._activity = new MediaActivity({media: this._media, artwork: this._artwork});
        this._media.connectObject(
            'state-changed', () => {
                this._activity.notifyChanged();
                this._syncActivity();
            },
            'track-changed', () => this._peek(),
            'status-changed', (_service, player) => {
                if (player.isPlaying)
                    this._peek();
            },
            this);
    }

    _syncActivity() {
        const player = this._media.active;
        if (player?.isPlaying && player.metadata.title)
            this._activities.start(this._activity);
        else
            this._activities.end(this._activity.id);
    }

    _peek() {
        const player = this._media.active;
        if (player?.isPlaying && player.metadata.title)
            this._activities.peek(this._activity, {duration: 4500, priority: Priority.LOW});
    }

    createView() {
        const root = new St.Widget({
            style_class: 'osmin-widget osmin-media',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });

        this._empty = this._buildEmpty();
        this._card = this._buildCard();
        root.add_child(this._empty);
        root.add_child(this._card);

        this._media.connectObject(
            'active-changed', () => this._refresh(),
            'state-changed', () => this._refresh(),
            this);
        this._refresh();
        return root;
    }

    onPageShown() {
        this._shown = true;
        this._player?.syncPosition();
        this._updateTicker();
        this._updateProgress();
    }

    onPageHidden() {
        this._shown = false;
        this._updateTicker();
    }

    destroy() {
        this._media.disconnectObject(this);
        this._activities.end('media');
        this._activity?.destroy();
        this._stopTicker();
        this._player = null;
        super.destroy();
    }

    _buildEmpty() {
        const box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            style_class: 'osmin-placeholder-icon',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(new St.Label({
            text: 'Nothing playing',
            style_class: 'osmin-placeholder-title',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        return box;
    }

    _buildCard() {
        const card = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'osmin-media-card',
        });

        this._source = new St.Label({style_class: 'osmin-media-source'});
        this._source.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        card.add_child(this._source);

        const top = new St.BoxLayout({style_class: 'osmin-media-top'});
        this._art = new St.Widget({
            style_class: 'osmin-media-art',
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._artIcon = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            style_class: 'osmin-media-art-icon',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._art.add_child(this._artIcon);
        top.add_child(this._art);

        const texts = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'osmin-media-texts',
        });
        this._title = new St.Label({style_class: 'osmin-media-title'});
        this._artist = new St.Label({style_class: 'osmin-media-artist'});
        for (const label of [this._title, this._artist])
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        texts.add_child(this._title);
        texts.add_child(this._artist);
        top.add_child(texts);
        card.add_child(top);

        // Progress bar inside a taller, clickable area.
        this._seekArea = new St.Widget({
            style_class: 'osmin-media-seek',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            x_expand: true,
        });
        this._bar = new St.Widget({
            style_class: 'osmin-media-bar',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._fill = new St.Widget({
            style_class: 'osmin-media-fill',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._bar.add_child(this._fill);
        this._seekArea.add_child(this._bar);
        this._seekArea.connect('button-press-event', (_actor, event) => this._onSeek(event));
        this._seekArea.connect('notify::width', () => this._updateProgress());
        card.add_child(this._seekArea);

        const times = new St.BoxLayout({x_expand: true, style_class: 'osmin-media-times'});
        this._elapsed = new St.Label({text: '0:00', style_class: 'osmin-media-time', x_expand: true});
        this._duration = new St.Label({text: '0:00', style_class: 'osmin-media-time'});
        times.add_child(this._elapsed);
        times.add_child(this._duration);
        card.add_child(times);

        const controls = new St.BoxLayout({
            style_class: 'osmin-media-controls',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._previousButton = createButton({
            iconName: 'media-skip-backward-symbolic',
            styleClass: 'osmin-media-button',
            onClick: () => this._player?.previous(),
        });
        this._playButton = createButton({
            iconName: 'media-playback-start-symbolic',
            styleClass: 'osmin-media-button osmin-media-play',
            onClick: () => this._player?.playPause(),
        });
        this._nextButton = createButton({
            iconName: 'media-skip-forward-symbolic',
            styleClass: 'osmin-media-button',
            onClick: () => this._player?.next(),
        });
        controls.add_child(this._previousButton);
        controls.add_child(this._playButton);
        controls.add_child(this._nextButton);
        card.add_child(controls);
        this._playIcon = this._playButton.get_child().get_first_child();
        return card;
    }

    _refresh() {
        const player = this._media.active;
        this._player = player;
        const hasTrack = player && player.metadata.title !== '';
        this._empty.visible = !hasTrack;
        this._card.visible = !!hasTrack;
        if (!hasTrack) {
            this._updateTicker();
            return;
        }

        const {title, artist, album, artUrl} = player.metadata;
        const playing = player.status === PlaybackStatus.PLAYING;
        this._source.text = `${player.identity} · ${playing ? 'Playing' : player.status}`;
        this._title.text = title;
        this._artist.text = artist || album;
        this._playIcon.icon_name = playing
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._previousButton.reactive = player.canGoPrevious;
        this._previousButton.opacity = player.canGoPrevious ? 255 : 90;
        this._nextButton.reactive = player.canGoNext;
        this._nextButton.opacity = player.canGoNext ? 255 : 90;
        this._seekArea.reactive = player.canSeek;
        this._duration.text = player.metadata.length > 0
            ? formatDuration(player.metadata.length) : '';

        this._setArtwork(artUrl);
        this._updateProgress();
        this._updateTicker();
    }

    async _setArtwork(url) {
        if (url === this._artUrl)
            return;
        this._artUrl = url;
        this._art.style = '';
        this._artIcon.show();
        const file = await this._artwork.resolve(url);
        if (!file || url !== this._artUrl || !this._view)
            return;
        this._art.style = `background-image: url("${file.get_uri()}"); background-size: cover;`;
        this._artIcon.hide();
    }

    _updateProgress() {
        const player = this._player;
        if (!player || !this._card?.visible)
            return;
        const {length} = player.metadata;
        const position = player.position;
        this._elapsed.text = formatDuration(position);
        const fraction = length > 0 ? Math.min(position / length, 1) : 0;
        this._fill.set_width(this._bar.mapped ? Math.round(this._bar.width * fraction) : 0);
    }

    _onSeek(event) {
        const player = this._player;
        const {length} = player?.metadata ?? {};
        if (!player || !length || !player.canSeek)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const [ok, localX] = this._bar.transform_stage_point(x, y);
        if (!ok || this._bar.width <= 0)
            return Clutter.EVENT_PROPAGATE;
        const fraction = Math.min(Math.max(localX / this._bar.width, 0), 1);
        player.seekTo(fraction * length);
        this._updateProgress();
        return Clutter.EVENT_STOP;
    }

    _updateTicker() {
        const needed = this._shown && this._player?.isPlaying;
        if (needed && !this._tickId) {
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
                this._updateProgress();
                return GLib.SOURCE_CONTINUE;
            });
            GLib.Source.set_name_by_id(this._tickId, '[osmin] media progress');
        } else if (!needed) {
            this._stopTicker();
        }
    }

    _stopTicker() {
        if (!this._tickId)
            return;
        GLib.source_remove(this._tickId);
        this._tickId = 0;
    }
}
