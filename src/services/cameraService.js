import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const FRAME_INTERVAL_MS = 40;      // ~25 fps
const START_TIMEOUT_MS = 4000;
const PREVIEW_SIZE = 240;

// The common tail: crop to a square (it is shown in a circle), scale to a small
// preview and hand BGRA frames to an appsink.
const TAIL = '! aspectratiocrop aspect-ratio=1/1 ! videoconvert ! videoscale ' +
    `! video/x-raw,format=BGRA,width=${PREVIEW_SIZE},height=${PREVIEW_SIZE} ` +
    '! appsink name=sink max-buffers=1 drop=true sync=false';

export const CameraState = Object.freeze({
    OFF: 'off',
    STARTING: 'starting',
    ON: 'on',
    ERROR: 'error',
});

/**
 * The webcam preview for the Mirror widget, through GStreamer.
 *
 * The camera is opened only by start() (a deliberate click) and released by
 * stop(); nothing is recorded or saved: frames are only drawn into
 * `content` (an St.ImageContent).
 *
 * Sources are tried in order: PipeWire (the camera the desktop exposes),
 * then /dev/video0 directly. GStreamer is loaded lazily, so a system
 * without it only loses the Mirror, not the whole extension.
 *
 * Signals: 'state-changed'.
 */
export class CameraService extends Signals.EventEmitter {
    constructor() {
        super();
        this.content = St.ImageContent.new_with_preferred_size(PREVIEW_SIZE, PREVIEW_SIZE);
        this.error = '';
        this.frames = 0;
        this._state = CameraState.OFF;
        this._Gst = null;
        this._pipeline = null;
        this._sink = null;
        this._pollId = 0;
        this._generation = 0;
    }

    get state() {
        return this._state;
    }

    /** Opens the camera. Resolves when the first frame arrives (or fails). */
    async start() {
        if (this._state === CameraState.STARTING || this._state === CameraState.ON)
            return;
        const generation = ++this._generation;
        this.error = '';
        this._setState(CameraState.STARTING);

        try {
            if (!this._Gst) {
                const module = await import('gi://Gst?version=1.0');
                this._Gst = module.default;
                this._Gst.init(null);
            }
        } catch (e) {
            this._fail(generation, 'GStreamer is not available');
            return;
        }

        for (const source of this._candidates()) {
            if (generation !== this._generation)
                return;
            if (await this._tryPipeline(`${source} ${TAIL}`, generation)) {
                if (generation === this._generation)
                    this._setState(CameraState.ON);
                return;
            }
        }
        this._fail(generation, 'No camera available');
    }

    /** Closes the camera. */
    stop() {
        this._generation++;
        this._teardown();
        this.error = '';
        this._setState(CameraState.OFF);
    }

    destroy() {
        this.stop();
    }

    _candidates() {
        // Developer override for testing without a camera.
        if (GLib.getenv('OSMIN_FAKE_CAMERA'))
            return ['videotestsrc is-live=true pattern=ball'];
        return ['pipewiresrc', 'v4l2src device=/dev/video0'];
    }

    _tryPipeline(description, generation) {
        const Gst = this._Gst;
        let pipeline;
        try {
            pipeline = Gst.parse_launch(description);
        } catch (e) {
            console.debug(`[osmin] camera pipeline "${description}" invalid: ${e.message}`);
            return Promise.resolve(false);
        }
        const sink = pipeline.get_by_name('sink');
        pipeline.set_state(Gst.State.PLAYING);

        return new Promise(resolve => {
            const startedAt = GLib.get_monotonic_time();
            let settled = false;
            const finish = ok => {
                if (settled)
                    return;
                settled = true;
                if (ok) {
                    this._pipeline = pipeline;
                    this._sink = sink;
                    this._startPolling();
                } else {
                    pipeline.set_state(Gst.State.NULL);
                }
                resolve(ok);
            };
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                if (generation !== this._generation) {
                    finish(false);
                    return GLib.SOURCE_REMOVE;
                }
                const message = pipeline.get_bus().pop_filtered(Gst.MessageType.ERROR);
                if (message) {
                    console.debug(`[osmin] camera source failed: ${message.parse_error()[0].message}`);
                    finish(false);
                    return GLib.SOURCE_REMOVE;
                }
                if (this._pullFrame(sink)) {
                    finish(true);
                    return GLib.SOURCE_REMOVE;
                }
                if ((GLib.get_monotonic_time() - startedAt) / 1000 > START_TIMEOUT_MS) {
                    finish(false);
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
            GLib.Source.set_name_by_id(id, '[osmin] camera start');
        });
    }

    _startPolling() {
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FRAME_INTERVAL_MS, () => {
            const message = this._pipeline?.get_bus().pop_filtered(this._Gst.MessageType.ERROR);
            if (message) {
                const text = message.parse_error()[0].message;
                this._pollId = 0;
                this._generation++;
                this._teardown();
                this.error = text;
                this._setState(CameraState.ERROR);
                return GLib.SOURCE_REMOVE;
            }
            this._pullFrame(this._sink);
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._pollId, '[osmin] camera frames');
    }

    /** Takes the newest frame from the appsink into `content`. */
    _pullFrame(sink) {
        const Gst = this._Gst;
        const sample = sink.emit('try-pull-sample', 0);
        if (!sample)
            return false;
        const buffer = sample.get_buffer();
        const structure = sample.get_caps().get_structure(0);
        const [, width] = structure.get_int('width');
        const [, height] = structure.get_int('height');
        const [mapped, info] = buffer.map(Gst.MapFlags.READ);
        if (!mapped)
            return false;
        try {
            const context = global.stage.context.get_backend().get_cogl_context();
            this.content.set_bytes(context, new GLib.Bytes(info.data), Cogl.PixelFormat.BGRA_8888,
                width, height, width * 4);
            this.frames++;
        } finally {
            buffer.unmap(info);
        }
        return true;
    }

    _teardown() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        if (this._pipeline) {
            this._pipeline.set_state(this._Gst.State.NULL);
            this._pipeline = null;
        }
        this._sink = null;
    }

    _fail(generation, message) {
        if (generation !== this._generation)
            return;
        this._teardown();
        this.error = message;
        this._setState(CameraState.ERROR);
    }

    _setState(state) {
        this._state = state;
        this.emit('state-changed');
    }
}
