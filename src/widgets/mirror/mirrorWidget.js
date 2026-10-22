import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {Priority} from '../../utils/events.js';
import {CameraState} from '../../services/cameraService.js';
import {createButton} from '../../ui/button.js';
import {OsminWidget} from '../widget.js';
import {MirrorActivity} from './mirrorActivity.js';
import {SquareLayout} from './squareLayout.js';
import {PullGesture} from '../../ui/pullGesture.js';

/**
 * Mirror: a round webcam preview, like looking in a small mirror. The camera
 * is opened only when you click the circle and is released when you click it
 * again, leave the page or close the capsule. Nothing is recorded or saved.
 */
export class MirrorWidget extends OsminWidget {
    static id = 'mirror';
    static title = 'Mirror';
    static iconName = 'camera-web-symbolic';

    constructor(context) {
        super(context);
        this._camera = context.services.camera;
        this._ui = context.ui;
        this._big = new MirrorActivity({camera: this._camera, onDismiss: () => this._shrink()});
        this._flipped = true; // a mirror: left and right swapped
        this._effect = null;
    }

    createView() {
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-widget osmin-mirror',
            x_expand: true,
            y_expand: true,
        });

        // The circle: the largest square that fits the column. Its holder has no
        // preferred size, so the circle's size never depends on its own size.
        const holder = new St.Widget({
            layout_manager: new SquareLayout(),
            x_expand: true,
            y_expand: true,
        });
        this._stage = new St.Widget({
            style_class: 'osmin-mirror-stage',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            track_hover: true,
        });
        holder.add_child(this._stage);
        this._stage.connect('button-press-event', (_actor, event) => {
            // A press on the flip button belongs to the button.
            const [x, y] = event.get_coords();
            const target = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
            if (target && (this._controls.contains(target) || this._enlarge.contains(target)))
                return Clutter.EVENT_PROPAGATE;
            this._toggle();
            return Clutter.EVENT_STOP;
        });
        // Two fingers down over the preview enlarge it, like the button.
        this._pull = new PullGesture(direction => {
            if (direction === 'down')
                this._enlargeNow();
        });
        this._stage.connect('scroll-event', (_actor, event) =>
            this._pull.handle(event) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE);
        this._stage.connect('notify::hover', () => {
            this._updateControls();
            this._enlarge.ease({opacity: this._stage.hover ? 255 : 0, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        });

        this._video = new St.Widget({
            style_class: 'osmin-mirror-video',
            x_expand: true,
            y_expand: true,
            content_gravity: Clutter.ContentGravity.RESIZE_FILL,
            content: this._camera.content,
        });
        this._video.set_pivot_point(0.5, 0.5);
        try {
            // Imported lazily: a GLSL problem only costs the round shape.
            import('./circleEffect.js').then(({CircleEffect}) => {
                if (this._video) {
                    this._effect = new CircleEffect();
                    this._video.add_effect(this._effect);
                }
            }).catch(e => console.warn(`[osmin] round mirror unavailable: ${e.message}`));
        } catch (e) {
            console.warn(`[osmin] round mirror unavailable: ${e.message}`);
        }
        this._stage.add_child(this._video);

        this._face = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-mirror-face',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._icon = new St.Icon({
            icon_name: 'camera-web-symbolic',
            style_class: 'osmin-mirror-icon',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._message = new St.Label({
            style_class: 'osmin-mirror-message',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._face.add_child(this._icon);
        this._face.add_child(this._message);
        this._stage.add_child(this._face);

        this._controls = new St.BoxLayout({
            style_class: 'osmin-mirror-controls',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            opacity: 0,
        });
        this._controls.add_child(createButton({
            iconName: 'object-flip-horizontal-symbolic',
            styleClass: 'osmin-mirror-control',
            onClick: () => {
                this._flipped = !this._flipped;
                this._applyFlip();
            },
        }));
        this._stage.add_child(this._controls);

        // The enlarge button: the capsule becomes a taller card with a big preview.
        this._enlarge = createButton({
            iconName: 'view-fullscreen-symbolic',
            styleClass: 'osmin-mirror-control',
            onClick: () => this._enlargeNow(),
        });
        this._enlarge.set({x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START});
        this._enlarge.opacity = 0;
        this._stage.add_child(this._enlarge);
        root.add_child(holder);

        this._camera.connectObject('state-changed', () => this._update(), this);
        return root;
    }

    onViewCreated() {
        this._applyFlip();
        this._update();
    }

    onPageHidden() {
        // The enlarged card is on screen: it owns the camera now.
        if (!this._big.shown)
            this._camera.stop();
    }

    _enlargeNow() {
        this._ui.showCard(this._big, {persistent: true, priority: Priority.HIGH});
    }

    _shrink() {
        this._ui.hideCard(this._big);
    }

    destroy() {
        this._camera.disconnectObject(this);
        if (!this._big.shown)
            this._camera.stop();
        this._big.destroy();
        this._pull?.destroy();
        if (this._effect) {
            this._video?.remove_effect(this._effect);
            this._effect = null;
        }
        super.destroy();
    }

    _toggle() {
        if (this._camera.state === CameraState.ON || this._camera.state === CameraState.STARTING)
            this._camera.stop();
        else
            this._camera.start();
    }

    _applyFlip() {
        this._video.scale_x = this._flipped ? -1 : 1;
    }

    _updateControls() {
        if (!this._controls)
            return;
        this._controls.ease({
            opacity: this._stage.hover && this._camera.state === CameraState.ON ? 255 : 0,
            duration: 140,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _update() {
        if (!this._view)
            return;
        const state = this._camera.state;
        const on = state === CameraState.ON;
        this._video.visible = on;
        this._face.visible = !on;
        this._controls.visible = on;
        switch (state) {
        case CameraState.STARTING:
            this._message.text = 'Starting…';
            break;
        case CameraState.ERROR:
            this._message.text = this._camera.error || 'No camera';
            break;
        default:
            this._message.text = 'Mirror';
        }
        this._updateControls();
    }
}
