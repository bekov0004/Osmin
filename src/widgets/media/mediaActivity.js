import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {PlaybackStatus} from '../../services/mediaService.js';
import {createButton} from '../../ui/button.js';
import {LiveActivity, createCompactRow} from '../../ui/liveActivity.js';

/** Music: ongoing while something plays; peeks when playback starts or the track changes. */
export class MediaActivity extends LiveActivity {
    constructor({media, artwork}) {
        super({id: 'media', widgetId: 'media', compactPriority: 10});
        this._media = media;
        this._artwork = artwork;
    }

    get player() {
        return this._media.active;
    }

    get title() {
        return this.player?.metadata.title || 'Media';
    }

    get peekSize() {
        return {width: 330, height: 62};
    }

    createCompactView() {
        return createCompactRow(this, 'audio-x-generic-symbolic', () => this.title);
    }

    createPeekView() {
        const box = new St.BoxLayout({
            style_class: 'osmin-peek',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const art = new St.Widget({
            style_class: 'osmin-peek-art',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(art);

        const texts = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'osmin-peek-texts',
        });
        const title = new St.Label({style_class: 'osmin-peek-title'});
        const artist = new St.Label({style_class: 'osmin-peek-subtitle'});
        for (const label of [title, artist])
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        texts.add_child(title);
        texts.add_child(artist);
        box.add_child(texts);

        const play = createButton({
            iconName: 'media-playback-pause-symbolic',
            styleClass: 'osmin-media-button osmin-media-play',
            onClick: () => this.player?.playPause(),
        });
        play.y_align = Clutter.ActorAlign.CENTER;
        box.add_child(play);
        const playIcon = play.get_child().get_first_child();

        let artUrl = null;
        const refresh = async () => {
            const player = this.player;
            if (!player)
                return;
            const metadata = player.metadata;
            title.text = metadata.title;
            artist.text = metadata.artist || metadata.album;
            playIcon.icon_name = player.status === PlaybackStatus.PLAYING
                ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
            if (metadata.artUrl !== artUrl) {
                artUrl = metadata.artUrl;
                art.style = '';
                const file = await this._artwork.resolve(artUrl);
                if (file && artUrl === metadata.artUrl && art.get_stage?.())
                    art.style = `background-image: url("${file.get_uri()}"); background-size: cover;`;
            }
        };
        this.connectObject('changed', refresh, box);
        box.connect('destroy', () => this.disconnectObject(box));
        refresh();
        return box;
    }
}
