import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gst from 'gi://Gst?version=1.0';
import Gtk from 'gi://Gtk?version=4.0';

import {PhoneControl} from '../../src/phone/phoneControl.js';

const TARGET_WIDTH = 720;        // the picture is asked at about this width: sharp enough, light on Wi-Fi
const BIT_RATE = 6000000;
const POLL_MS = 16;
const RESTART_MS = 1200;         // screenrecord stops by itself after three minutes: start it again

// The phone's video comes in on a pipe (fdsrc) and the last decoded picture is read from gdkpixbufsink.
// One decoding thread and no queues: every frame that arrives is shown at once.
const pipeline = fd => `fdsrc fd=${fd} blocksize=16384 ! h264parse ! avdec_h264 max-threads=1 ! videoconvert ! gdkpixbufsink name=sink sync=false qos=false`;

/** "Physical size: 1080x2400" (and "Override size:") -> {w, h} */
export function parseSize(text) {
    const override = /Override size:\s*(\d+)x(\d+)/.exec(text);
    const physical = /Physical size:\s*(\d+)x(\d+)/.exec(text);
    const match = override ?? physical;
    return match ? {w: Number(match[1]), h: Number(match[2])} : null;
}

/**
 * The window that shows an Android phone and controls it. The picture is the phone's own
 * `screenrecord` (H.264, sent over adb) decoded with GStreamer; the mouse and the keyboard are sent
 * back as the phone's own `input` commands through one long-running `adb shell`. Nothing is installed
 * on the phone.
 */
export class PhoneViewer {
    /**
     * @param {{adb: string, serial: string, title?: string, onClose?: () => void}} options
     */
    constructor({adb, serial, title = 'Phone', onClose = () => {}, onDock = null}) {
        this._adb = adb;
        this._serial = serial;
        this._onClose = onClose;
        this._onDock = onDock;
        this._closed = false;
        this._screen = null;        // the phone's real screen size
        this._video = null;
        this._control = null;
        this._pipeline = null;
        this._pollId = 0;
        this._restartId = 0;
        this._frames = 0;
        // The service is a plain Gio.Application: GTK is started by hand before the first window.
        GLib.set_prgname('dev.osmin.Osmin');
        Adw.init();
        this._buildWindow(title);
        this._start();
    }

    present() {
        this._window.present();
    }

    get frames() {
        return this._frames;
    }

    close() {
        this._window.close();
    }

    // --- the window ------------------------------------------------------------------------------

    _buildWindow(title) {
        const window = new Gtk.Window({title, default_width: 340, default_height: 720});
        this._window = window;
        const header = new Gtk.HeaderBar();
        window.set_titlebar(header);
        const button = (icon, tooltip, action) => {
            const b = Gtk.Button.new_from_icon_name(icon);
            b.tooltip_text = tooltip;
            b.connect('clicked', action);
            return b;
        };
        if (this._onDock)
            header.pack_end(button('view-restore-symbolic', 'Put the phone back in the Osmin panel', () => this._onDock()));
        header.pack_start(button('go-previous-symbolic', 'Back', () => this._key(4)));
        header.pack_start(button('go-home-symbolic', 'Home', () => this._key(3)));
        header.pack_start(button('view-grid-symbolic', 'Recent apps', () => this._key(187)));
        header.pack_end(button('system-shutdown-symbolic', 'Lock or wake the screen', () => this._key(26)));
        header.pack_end(button('preferences-system-notifications-symbolic', 'Notifications', () => this._control?.shell('cmd statusbar expand-notifications')));

        this._picture = new Gtk.Picture({content_fit: Gtk.ContentFit.CONTAIN, can_shrink: true, hexpand: true, vexpand: true});
        this._picture.add_css_class('osmin-phone-picture');
        this._status = new Gtk.Label({label: 'Connecting to the phone…', wrap: true, justify: Gtk.Justification.CENTER, margin_start: 24, margin_end: 24});
        const overlay = new Gtk.Overlay({child: this._picture});
        overlay.add_overlay(this._status);
        this._status.halign = Gtk.Align.CENTER;
        this._status.valign = Gtk.Align.CENTER;
        window.set_child(overlay);

        // Mouse: the finger follows the pointer (down, moves, up), so a click is a tap and a drag is a swipe.
        const drag = new Gtk.GestureDrag({button: 1});
        let origin = null;
        let touching = false;
        drag.connect('drag-begin', (_g, x, y) => {
            origin = [x, y];
            const point = this._toPhone(x, y);
            touching = !!point;
            if (point)
                this._control?.down(point[0], point[1]);
        });
        drag.connect('drag-update', (_g, dx, dy) => {
            if (!touching || !origin)
                return;
            const point = this._toPhone(origin[0] + dx, origin[1] + dy, true);
            if (point)
                this._control?.move(point[0], point[1]);
        });
        drag.connect('drag-end', (_g, dx, dy) => {
            if (!touching || !origin)
                return;
            const point = this._toPhone(origin[0] + dx, origin[1] + dy, true);
            touching = false;
            if (point)
                this._control?.up(point[0], point[1]);
        });
        this._picture.add_controller(drag);

        // The wheel scrolls the phone
        const scroll = new Gtk.EventControllerScroll({flags: Gtk.EventControllerScrollFlags.VERTICAL});
        let lastScroll = 0;
        scroll.connect('scroll', (_c, _dx, dy) => {
            const now = GLib.get_monotonic_time();
            if (!this._screen || now - lastScroll < 200000)
                return true;
            lastScroll = now;
            const x = Math.round(this._screen.w / 2);
            const y = Math.round(this._screen.h / 2);
            const d = Math.round(this._screen.h * 0.25) * (dy > 0 ? -1 : 1);
            this._control?.swipe(x, y, x, y + d, 220);
            return true;
        });
        this._picture.add_controller(scroll);

        // Keyboard: letters are typed on the phone
        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_c, keyval, _code, state) => {
            if (state & (Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK))
                return false;
            const special = {[Gdk.KEY_BackSpace]: 67, [Gdk.KEY_Return]: 66, [Gdk.KEY_KP_Enter]: 66, [Gdk.KEY_Tab]: 61,
                [Gdk.KEY_Escape]: 4, [Gdk.KEY_Home]: 3, [Gdk.KEY_Left]: 21, [Gdk.KEY_Right]: 22, [Gdk.KEY_Up]: 19, [Gdk.KEY_Down]: 20,
                [Gdk.KEY_Delete]: 112};
            if (special[keyval] !== undefined) {
                this._key(special[keyval]);
                return true;
            }
            const unicode = Gdk.keyval_to_unicode(keyval);
            if (unicode >= 32 && unicode < 127) {
                this._control?.text(String.fromCodePoint(unicode));
                return true;
            }
            return false;
        });
        window.add_controller(keys);

        window.connect('close-request', () => {
            this._shutdown();
            return false;
        });
    }

    /** A point of the window -> a pixel of the phone (null outside the picture). */
    _toPhone(x, y, clamp = false) {
        if (!this._screen)
            return null;
        const width = this._picture.get_width();
        const height = this._picture.get_height();
        const scale = Math.min(width / this._screen.w, height / this._screen.h);
        const left = (width - this._screen.w * scale) / 2;
        const top = (height - this._screen.h * scale) / 2;
        const px = (x - left) / scale;
        const py = (y - top) / scale;
        if (clamp)
            return [Math.round(Math.min(Math.max(px, 0), this._screen.w - 1)), Math.round(Math.min(Math.max(py, 0), this._screen.h - 1))];
        if (px < 0 || py < 0 || px > this._screen.w || py > this._screen.h)
            return null;
        return [Math.round(px), Math.round(py)];
    }

    // --- the phone -------------------------------------------------------------------------------

    _start() {
        try {
            Gst.init(null);
        } catch (e) {
            this._fail(`GStreamer is not available: ${e.message}`);
            return;
        }
        this._control = new PhoneControl({adb: this._adb, serial: this._serial});
        const size = Gio.Subprocess.new([this._adb, '-s', this._serial, 'shell', 'wm', 'size'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        size.communicate_utf8_async(null, null, (_p, result) => {
            try {
                const [, out] = size.communicate_utf8_finish(result);
                this._screen = parseSize(out ?? '');
            } catch (e) {
                this._screen = null;
            }
            if (this._closed)
                return;
            if (!this._screen) {
                this._fail('Could not read the screen size of the phone. Is it still connected and unlocked?');
                return;
            }
            const ratio = this._screen.h / this._screen.w;
            this._window.set_default_size(340, Math.round(340 * ratio) + 48);
            this._startVideo();
        });
    }

    _startVideo() {
        if (this._closed)
            return;
        const width = Math.min(TARGET_WIDTH, this._screen.w);
        const height = Math.round((this._screen.h * width) / this._screen.w / 16) * 16;
        const size = `${Math.round(width / 16) * 16}x${height}`;
        const video = Gio.Subprocess.new([this._adb, '-s', this._serial, 'exec-out', 'screenrecord',
            '--output-format=h264', `--size=${size}`, `--bit-rate=${BIT_RATE}`, '-'],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        this._video = video;
        const stdout = video.get_stdout_pipe();
        this._pipeline = Gst.parse_launch(pipeline(stdout.get_fd()));
        this._sink = this._pipeline.get_by_name('sink');
        this._pipeline.set_state(Gst.State.PLAYING);
        // The pictures are taken here, on the main thread, a few times a second.
        let lastShown = null;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            const pixbuf = this._sink?.last_pixbuf;
            if (pixbuf && pixbuf !== lastShown) {
                lastShown = pixbuf;
                this._picture.set_paintable(Gdk.Texture.new_for_pixbuf(pixbuf));
                if (this._frames++ === 0)
                    this._status.visible = false;
            }
            return GLib.SOURCE_CONTINUE;
        });
        const startedAt = GLib.get_monotonic_time();
        video.wait_async(null, () => {
            if (this._closed || this._video !== video)
                return;
            this._stopVideo();
            // Normal after three minutes. When it ends at once, say why.
            if (this._frames === 0 || GLib.get_monotonic_time() - startedAt < 4000000) {
                const err = video.get_stderr_pipe();
                err.read_bytes_async(2000, GLib.PRIORITY_DEFAULT, null, (_s, result) => {
                    try {
                        const text = new TextDecoder().decode(err.read_bytes_finish(result).toArray()).trim();
                        this._fail(text ? `The phone did not send a picture:\n${text.split('\n')[0]}` : 'The phone did not send a picture.');
                    } catch (e) {
                        this._fail('The phone did not send a picture.');
                    }
                });
            }
            this._restartId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RESTART_MS, () => {
                this._restartId = 0;
                this._startVideo();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _stopVideo() {
        if (this._pollId)
            GLib.source_remove(this._pollId);
        this._pollId = 0;
        this._pipeline?.set_state(Gst.State.NULL);
        this._pipeline = null;
        this._sink = null;
    }

    _fail(text) {
        this._status.label = text;
        this._status.visible = true;
    }

    // --- control -----------------------------------------------------------------------------------

    _key(code) {
        this._control?.key(code);
    }

    // --- the end --------------------------------------------------------------------------------------

    _shutdown() {
        if (this._closed)
            return;
        this._closed = true;
        if (this._restartId)
            GLib.source_remove(this._restartId);
        this._stopVideo();
        this._video?.force_exit();
        this._control?.destroy();
        this._onClose();
    }
}
