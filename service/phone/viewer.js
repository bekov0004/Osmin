import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gst from 'gi://Gst?version=1.0';
import Gtk from 'gi://Gtk?version=4.0';

const TARGET_WIDTH = 720;        // the picture is asked at about this width: sharp enough, light on Wi-Fi
const BIT_RATE = 6000000;
const POLL_MS = 50;
const RESTART_MS = 1200;         // screenrecord stops by itself after three minutes: start it again
const TAP_MAX_PX = 10;
const TAP_MAX_MS = 350;
const LONG_PRESS_MS = 500;

// The phone's video comes in on a pipe (fdsrc) and the last decoded picture is read from gdkpixbufsink.
const pipeline = fd => `fdsrc fd=${fd} ! h264parse ! avdec_h264 ! videoconvert ! gdkpixbufsink name=sink`;

/** "Physical size: 1080x2400" (and "Override size:") -> {w, h} */
export function parseSize(text) {
    const override = /Override size:\s*(\d+)x(\d+)/.exec(text);
    const physical = /Physical size:\s*(\d+)x(\d+)/.exec(text);
    const match = override ?? physical;
    return match ? {w: Number(match[1]), h: Number(match[2])} : null;
}

/** What `adb input text` needs: spaces as %s and the shell's special characters escaped. */
export function escapeInputText(text) {
    return text.replace(/[^A-Za-z0-9._,@:/+=-]/g, ch => (ch === ' ' ? '%s' : `\\${ch}`));
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
    constructor({adb, serial, title = 'Phone', onClose = () => {}}) {
        this._adb = adb;
        this._serial = serial;
        this._onClose = onClose;
        this._closed = false;
        this._screen = null;        // the phone's real screen size
        this._video = null;
        this._shell = null;
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
        header.pack_start(button('go-previous-symbolic', 'Back', () => this._key(4)));
        header.pack_start(button('go-home-symbolic', 'Home', () => this._key(3)));
        header.pack_start(button('view-grid-symbolic', 'Recent apps', () => this._key(187)));
        header.pack_end(button('system-shutdown-symbolic', 'Lock or wake the screen', () => this._key(26)));
        header.pack_end(button('preferences-system-notifications-symbolic', 'Notifications', () => this._run('cmd statusbar expand-notifications')));

        this._picture = new Gtk.Picture({content_fit: Gtk.ContentFit.CONTAIN, can_shrink: true, hexpand: true, vexpand: true});
        this._picture.add_css_class('osmin-phone-picture');
        this._status = new Gtk.Label({label: 'Connecting to the phone…', wrap: true, justify: Gtk.Justification.CENTER, margin_start: 24, margin_end: 24});
        const overlay = new Gtk.Overlay({child: this._picture});
        overlay.add_overlay(this._status);
        this._status.halign = Gtk.Align.CENTER;
        this._status.valign = Gtk.Align.CENTER;
        window.set_child(overlay);

        // Mouse: a click is a tap, a drag is a swipe, a click that stays is a long press.
        const drag = new Gtk.GestureDrag({button: 1});
        let begun = 0;
        let start = null;
        drag.connect('drag-begin', (_g, x, y) => {
            begun = GLib.get_monotonic_time();
            start = [x, y];
        });
        drag.connect('drag-end', (_g, dx, dy) => {
            if (!start)
                return;
            const ms = Math.round((GLib.get_monotonic_time() - begun) / 1000);
            const a = this._toPhone(start[0], start[1]);
            const b = this._toPhone(start[0] + dx, start[1] + dy);
            start = null;
            if (!a || !b)
                return;
            if (Math.hypot(dx, dy) <= TAP_MAX_PX)
                this._run(ms >= LONG_PRESS_MS ? `input swipe ${a[0]} ${a[1]} ${a[0]} ${a[1]} ${Math.max(ms, 600)}` : `input tap ${a[0]} ${a[1]}`);
            else
                this._run(`input swipe ${a[0]} ${a[1]} ${b[0]} ${b[1]} ${Math.min(Math.max(ms, 80), TAP_MAX_MS * 3)}`);
        });
        this._picture.add_controller(drag);

        // The wheel scrolls the phone
        const scroll = new Gtk.EventControllerScroll({flags: Gtk.EventControllerScrollFlags.VERTICAL});
        let lastScroll = 0;
        scroll.connect('scroll', (_c, _dx, dy) => {
            const now = GLib.get_monotonic_time();
            if (!this._screen || now - lastScroll < 250000)
                return true;
            lastScroll = now;
            const x = Math.round(this._screen.w / 2);
            const y = Math.round(this._screen.h / 2);
            const d = Math.round(this._screen.h * 0.25) * (dy > 0 ? -1 : 1);
            this._run(`input swipe ${x} ${y} ${x} ${y + d} 220`);
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
                this._run(`input text ${escapeInputText(String.fromCodePoint(unicode))}`);
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
    _toPhone(x, y) {
        if (!this._screen)
            return null;
        const width = this._picture.get_width();
        const height = this._picture.get_height();
        const scale = Math.min(width / this._screen.w, height / this._screen.h);
        const left = (width - this._screen.w * scale) / 2;
        const top = (height - this._screen.h * scale) / 2;
        const px = (x - left) / scale;
        const py = (y - top) / scale;
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
        this._shell = Gio.Subprocess.new([this._adb, '-s', this._serial, 'shell'],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
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

    _run(command) {
        if (this._closed || !this._shell)
            return;
        try {
            this._shell.get_stdin_pipe().write_all(`${command}\n`, null);
        } catch (e) {
            this._fail(`Lost the phone: ${e.message}`);
        }
    }

    _key(code) {
        this._run(`input keyevent ${code}`);
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
        this._shell?.force_exit();
        this._onClose();
    }
}
