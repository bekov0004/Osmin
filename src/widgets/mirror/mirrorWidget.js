import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {CameraState} from '../../services/cameraService.js';
import {createButton} from '../../ui/button.js';
import {OsminWidget} from '../widget.js';

/**
 * Mirror: a live webcam preview. The camera is opened only when you press
 * "Turn on" and is released as soon as you close the preview, leave this page
 * or close the capsule. Nothing is recorded or saved.
 */
export class MirrorWidget extends OsminWidget {
    static id = 'mirror';
    static title = 'Mirror';
    static iconName = 'camera-web-symbolic';

    constructor(context) {
        super(context);
        this._camera = context.services.camera;
        this._flipped = true; // a mirror: left and right swapped
    }

    createView() {
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-widget osmin-mirror',
            x_expand: true,
            y_expand: true,
        });
        root.add_child(new St.Label({text: 'MIRROR', style_class: 'osmin-mirror-caption'}));

        // The preview, with the controls laid over it.
        this._stage = new St.Widget({
            style_class: 'osmin-mirror-stage',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });

        this._video = new St.Widget({
            style_class: 'osmin-mirror-video',
            x_expand: true,
            y_expand: true,
            content_gravity: Clutter.ContentGravity.RESIZE_ASPECT,
            content: this._camera.content,
        });
        this._video.set_pivot_point(0.5, 0.5);
        this._stage.add_child(this._video);

        this._message = new St.Label({
            style_class: 'osmin-mirror-message',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._stage.add_child(this._message);

        this._controls = new St.BoxLayout({
            style_class: 'osmin-mirror-controls',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
        });
        this._controls.add_child(createButton({
            iconName: 'object-flip-horizontal-symbolic',
            styleClass: 'osmin-mirror-control',
            onClick: () => {
                this._flipped = !this._flipped;
                this._applyFlip();
            },
        }));
        this._controls.add_child(createButton({
            iconName: 'window-close-symbolic',
            styleClass: 'osmin-mirror-control',
            onClick: () => this._camera.stop(),
        }));
        this._stage.add_child(this._controls);
        root.add_child(this._stage);

        this._toggle = createButton({
            label: 'Turn on',
            iconName: 'camera-web-symbolic',
            styleClass: 'osmin-mirror-toggle',
            expand: true,
            onClick: () => this._camera.start(),
        });
        root.add_child(this._toggle);

        this._camera.connectObject('state-changed', () => this._update(), this);
        return root;
    }

    onViewCreated() {
        this._applyFlip();
        this._update();
    }

    onPageHidden() {
        this._camera.stop();
    }

    destroy() {
        this._camera.disconnectObject(this);
        this._camera.stop();
        super.destroy();
    }

    _applyFlip() {
        this._video.scale_x = this._flipped ? -1 : 1;
    }

    _update() {
        if (!this._view)
            return;
        const state = this._camera.state;
        const on = state === CameraState.ON;
        this._video.visible = on;
        this._controls.visible = on;
        this._message.visible = !on;
        this._toggle.visible = !on;

        switch (state) {
        case CameraState.STARTING:
            this._message.text = 'Starting the camera…';
            this._toggle.visible = false;
            break;
        case CameraState.ERROR:
            this._message.text = this._camera.error || 'Camera unavailable';
            this._toggle.get_child().get_last_child().text = 'Try again';
            break;
        default:
            this._message.text = 'The camera is off';
            this._toggle.get_child().get_last_child().text = 'Turn on';
        }
    }
}
