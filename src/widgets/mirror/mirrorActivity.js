import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {CameraState} from '../../services/cameraService.js';
import {createButton} from '../../ui/button.js';
import {LiveActivity} from '../../ui/liveActivity.js';
import {scaled} from '../../utils/scale.js';

const SIDE = 220; // css px

/**
 * The enlarged mirror: a card as wide as the music card, but taller, with a big square
 * preview. It is shown (persistent) from the Mirror widget's enlarge button and
 * goes away with its close button; the camera runs only while it is on screen.
 * It is never "ongoing": it has no compact face.
 */
export class MirrorActivity extends LiveActivity {
    constructor({camera, onDismiss}) {
        super({id: 'mirror', widgetId: 'mirror'});
        this._camera = camera;
        this._onDismiss = onDismiss;
        this._flipped = true;
        this.shown = false;
    }

    get title() {
        return 'Mirror';
    }

    get peekSize() {
        return {width: 330, height: SIDE + 56};
    }

    createCompactParts() {
        throw new Error('The enlarged mirror has no compact face');
    }

    createPeekView() {
        const root = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            height: scaled(SIDE + 22),
        });
        const stage = new St.Widget({
            style_class: 'osmin-mirror-stage osmin-mirror-stage-square',
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            width: scaled(SIDE),
            height: scaled(SIDE),
        });
        const video = new St.Widget({
            x_expand: true,
            y_expand: true,
            content_gravity: Clutter.ContentGravity.RESIZE_FILL,
            content: this._camera.content,
        });
        video.set_pivot_point(0.5, 0.5);
        video.scale_x = this._flipped ? -1 : 1;
        let gone = false;
        import('./roundedEffect.js').then(({RoundedEffect}) => {
            if (!gone)
                video.add_effect(new RoundedEffect());
        }).catch(e => console.warn(`[osmin] rounded mirror unavailable: ${e.message}`));
        stage.add_child(video);

        const message = new St.Label({
            style_class: 'osmin-mirror-message',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        stage.add_child(message);
        root.add_child(stage);

        const side = (iconName, alignY, onClick) => {
            const button = createButton({iconName, styleClass: 'osmin-mirror-control', onClick});
            button.set({x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.END, y_align: alignY});
            button.style = 'margin: 0 6px 4px 0;';
            return button;
        };
        root.add_child(side('view-restore-symbolic', Clutter.ActorAlign.START, () => this._onDismiss()));
        root.add_child(side('object-flip-horizontal-symbolic', Clutter.ActorAlign.END, () => {
            this._flipped = !this._flipped;
            video.scale_x = this._flipped ? -1 : 1;
        }));

        const update = () => {
            const state = this._camera.state;
            video.visible = state === CameraState.ON;
            message.visible = state !== CameraState.ON;
            message.text = state === CameraState.ERROR ? (this._camera.error || 'No camera') : 'Starting…';
        };
        this._camera.connectObject('state-changed', update, root);
        update();

        this.shown = true;
        this._camera.start();
        root.connect('destroy', () => {
            gone = true;
            this._camera.disconnectObject(root);
            this.shown = false;
            this._camera.stop();
        });
        return root;
    }
}
