import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {PhoneControl} from './phoneControl.js';

const TARGET_WIDTH = 540;
const BIT_RATE = 5000000;
const POLL_MS = 16;
const RESTART_MS = 800;
// One decoding thread and no queues: a frame that arrives is shown at once.
const pipeline = fd => `fdsrc fd=${fd} blocksize=16384 ! h264parse ! avdec_h264 max-threads=1 ! videoconvert ! ` +
    'video/x-raw,format=BGRA ! appsink name=sink max-buffers=1 drop=true sync=false';

export const StreamState = Object.freeze({OFF: 'off', STARTING: 'starting', ON: 'on', ERROR: 'error'});

/** "Physical size: 1080x2400" (and "Override size:") -> {w, h} */
export function parseSize(text) {
    const match = /Override size:\s*(\d+)x(\d+)/.exec(text) ?? /Physical size:\s*(\d+)x(\d+)/.exec(text);
    return match ? {w: Number(match[1]), h: Number(match[2])} : null;
}

/**
 * The screen of a phone, decoded here with GStreamer into an image the capsule draws: the phone's own
 * `screenrecord` (H.264) comes through adb, and touches and keys go back through PhoneControl.
 * Signals: 'state-changed', 'content-changed' (a new St.ImageContent: the picture changed size).
 */
export class PhoneStream extends Signals.EventEmitter {
    constructor() {
        super();
        this.content = null;
        this.screen = null;          // the phone's real screen size in pixels
        this.control = null;
        this.error = '';
        this.frames = 0;
        this._state = StreamState.OFF;
        this._Gst = null;
        this._adb = null;
        this._serial = null;
        this._generation = 0;
        this._video = null;
        this._pipeline = null;
        this._sink = null;
        this._pollId = 0;
        this._restartId = 0;
        this._size = null;           // the size of the picture in this.content
    }

    get state() {
        return this._state;
    }

    get serial() {
        return this._serial;
    }

    async start(adb, serial) {
        if (this._serial === serial && this._state !== StreamState.OFF && this._state !== StreamState.ERROR)
            return;
        this.stop();
        const generation = ++this._generation;
        this._adb = adb;
        this._serial = serial;
        this.error = '';
        this._setState(StreamState.STARTING);
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
        const screen = await this._readSize(adb, serial);
        if (generation !== this._generation)
            return;
        if (!screen) {
            this._fail(generation, 'Could not read the screen of the phone. Is it unlocked and connected?');
            return;
        }
        this.screen = screen;
        this.control = new PhoneControl({adb, serial});
        this._startVideo(generation);
    }

    stop() {
        this._generation++;
        if (this._restartId)
            GLib.source_remove(this._restartId);
        this._restartId = 0;
        this._stopVideo();
        this.control?.destroy();
        this.control = null;
        this._serial = null;
        this.frames = 0;
        if (this._state !== StreamState.OFF)
            this._setState(StreamState.OFF);
    }

    destroy() {
        this.stop();
    }

    _readSize(adb, serial) {
        return new Promise(resolve => {
            let process;
            try {
                process = Gio.Subprocess.new([adb, '-s', serial, 'shell', 'wm', 'size'],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            } catch (e) {
                resolve(null);
                return;
            }
            process.communicate_utf8_async(null, null, (_p, result) => {
                try {
                    resolve(parseSize(process.communicate_utf8_finish(result)[1] ?? ''));
                } catch (e) {
                    resolve(null);
                }
            });
        });
    }

    _startVideo(generation) {
        if (generation !== this._generation)
            return;
        const Gst = this._Gst;
        const width = Math.round(Math.min(TARGET_WIDTH, this.screen.w) / 16) * 16;
        const height = Math.round((this.screen.h * width) / this.screen.w / 16) * 16;
        let video;
        try {
            video = Gio.Subprocess.new([this._adb, '-s', this._serial, 'exec-out', 'screenrecord',
                '--output-format=h264', `--size=${width}x${height}`, `--bit-rate=${BIT_RATE}`, '-'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            this._pipeline = Gst.parse_launch(pipeline(video.get_stdout_pipe().get_fd()));
        } catch (e) {
            this._fail(generation, e.message);
            return;
        }
        this._video = video;
        this._sink = this._pipeline.get_by_name('sink');
        this._pipeline.set_state(Gst.State.PLAYING);
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            if (generation !== this._generation)
                return GLib.SOURCE_REMOVE;
            this._pull();
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._pollId, '[osmin] phone frames');
        const startedAt = GLib.get_monotonic_time();
        video.wait_async(null, () => {
            if (generation !== this._generation || this._video !== video)
                return;
            this._stopVideo();
            // Normal after three minutes. If it ended at once, say why.
            if (this.frames === 0 || GLib.get_monotonic_time() - startedAt < 4000000) {
                const err = video.get_stderr_pipe();
                err.read_bytes_async(2000, GLib.PRIORITY_DEFAULT, null, (_s, result) => {
                    let text = '';
                    try {
                        text = new TextDecoder().decode(err.read_bytes_finish(result).toArray()).trim().split('\n')[0];
                    } catch (e) {
                        // ignore
                    }
                    if (generation === this._generation && this.frames === 0)
                        this._fail(generation, text ? `The phone did not send a picture: ${text}` : 'The phone did not send a picture.');
                });
                return;
            }
            this._restartId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RESTART_MS, () => {
                this._restartId = 0;
                this._startVideo(generation);
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _stopVideo() {
        if (this._pollId)
            GLib.source_remove(this._pollId);
        this._pollId = 0;
        if (this._pipeline && this._Gst)
            this._pipeline.set_state(this._Gst.State.NULL);
        this._pipeline = null;
        this._sink = null;
        this._video?.force_exit();
        this._video = null;
    }

    /** Takes the newest frame from the appsink into `content`. */
    _pull() {
        const sample = this._sink?.emit('try-pull-sample', 0);
        if (!sample)
            return;
        const Gst = this._Gst;
        const buffer = sample.get_buffer();
        const structure = sample.get_caps().get_structure(0);
        const [, width] = structure.get_int('width');
        const [, height] = structure.get_int('height');
        const [mapped, info] = buffer.map(Gst.MapFlags.READ);
        if (!mapped)
            return;
        try {
            if (!this.content || !this._size || this._size.w !== width || this._size.h !== height) {
                this.content = St.ImageContent.new_with_preferred_size(width, height);
                this._size = {w: width, h: height};
                this.emit('content-changed');
            }
            const context = global.stage.context.get_backend().get_cogl_context();
            this.content.set_bytes(context, new GLib.Bytes(info.data), Cogl.PixelFormat.BGRA_8888, width, height, width * 4);
            if (this.frames++ === 0)
                this._setState(StreamState.ON);
        } finally {
            buffer.unmap(info);
        }
    }

    _fail(generation, message) {
        if (generation !== this._generation)
            return;
        this._stopVideo();
        this.error = message;
        this._setState(StreamState.ERROR);
    }

    _setState(state) {
        this._state = state;
        this.emit('state-changed');
    }
}
