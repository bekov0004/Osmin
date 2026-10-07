// Runs in its own process (gjs -m dragout.js). GNOME Shell cannot start a drag into
// another application itself, so the shell keeps this tiny helper warm and, when a file
// is dragged out of the tray, puts the helper's window under the pointer and hands it a
// fresh touch; the window then starts a real drag with the files.
//
// Protocol, one JSON object per line:
//   stdin  (from the shell)  {"cmd":"show","uris":[...]}  map the window with these files
//                            {"cmd":"hide"}                unmap it (drag over or aborted)
//                            {"cmd":"quit"}
//   stdout (to the shell)    {"ev":"ready"}                the process is up
//                            {"ev":"begin"}                the drag really started
//                            {"ev":"end"}                  the drag finished (dropped or cancelled)
//
// The process never touches the GPU (software rendering, no GL / Vulkan / dmabuf): it is
// started and stopped often, and a window of 140 px needs nothing else. It leaves on its
// own when the shell goes away (stdin closes) or when it has been idle for a while.
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

const IDLE_SECONDS = 45;
const WINDOW_SIZE = 64;

Gtk.init();
const loop = new GLib.MainLoop(null, false);
const encoder = new TextEncoder();
const stdout = new Gio.DataOutputStream({base_stream: GioUnix.OutputStream.new(1, false)});



// OSMIN_DRAGOUT_LOG=/path writes what the helper sees (for debugging only).
const LOG = GLib.getenv('OSMIN_DRAGOUT_LOG');
function dbg(text) {
    if (!LOG)
        return;
    try {
        const out = Gio.File.new_for_path(LOG).append_to(Gio.FileCreateFlags.NONE, null);
        out.write_all(new TextEncoder().encode(`${(GLib.get_monotonic_time() / 1000) | 0} ${text}\n`), null);
        out.close(null);
    } catch (e) {
        // debugging only
    }
}

function send(object) {
    try {
        stdout.put_string(`${JSON.stringify(object)}\n`, null);
        stdout.flush(null);
    } catch (e) {
        // The shell is gone; the stdin watcher will end the process.
    }
}

let uris = [];
let dragging = false;
let idleId = 0;

const css = new Gtk.CssProvider();
// 1% of black: invisible to the eye, but a fully transparent window is never mapped.
css.load_from_string('window.osmin-dragout { background: rgba(0, 0, 0, 0.01); } window.osmin-dragout box { background: transparent; }');
Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

// The window is only a place to put a finger on: it must never be seen. (The picture that
// follows the pointer during the drag is made from `box`, not from the window.)
const win = new Gtk.Window({
    title: 'OsminDragOut',
    decorated: false,
    resizable: false,
    default_width: WINDOW_SIZE,
    default_height: WINDOW_SIZE,
    css_classes: ['osmin-dragout'],
});
// Nothing is drawn in the window: it is (almost) transparent and empty.
const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, halign: Gtk.Align.FILL, valign: Gtk.Align.FILL, hexpand: true, vexpand: true, width_request: WINDOW_SIZE, height_request: WINDOW_SIZE});
win.set_child(box);
let fileIcon = null;

const source = new Gtk.DragSource({actions: Gdk.DragAction.COPY | Gdk.DragAction.LINK});
source.connect('prepare', () => {
    dbg('prepare');
    const list = uris.map(uri => `${uri}\r\n`).join('');
    const paths = uris.map(uri => Gio.File.new_for_uri(uri).get_path()).join('\n');
    return Gdk.ContentProvider.new_union([
        Gdk.ContentProvider.new_for_bytes('text/uri-list', new GLib.Bytes(encoder.encode(list))),
        Gdk.ContentProvider.new_for_bytes('text/plain', new GLib.Bytes(encoder.encode(paths))),
    ]);
});
source.connect('drag-begin', () => {
    dbg('drag-begin');
    dragging = true;
    // The picture that follows the pointer: the file's icon, straight from the icon theme.
    try {
        const theme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        source.set_icon(theme.lookup_by_gicon(fileIcon, 48, 1, Gtk.TextDirection.NONE, 0), 24, 24);
    } catch (e) {
        // the default drag icon will do
    }
    send({ev: 'begin'});
});
source.connect('drag-end', () => {
    dbg('drag-end');
    dragging = false;
    send({ev: 'end'});
    // Let the drop settle, then get out of the way.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        win.set_visible(false);
        return GLib.SOURCE_REMOVE;
    });
});
box.add_controller(source);
{
    const probe = new Gtk.EventControllerLegacy();
    probe.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
    probe.connect('event', (_c, ev) => {
        const type = ev.get_event_type();
        if (type !== Gdk.EventType.MOTION_NOTIFY)
            dbg(`event ${type}`);
        return false;
    });
    win.add_controller(probe);
    win.connect('map', () => dbg('map'));
    win.connect('unmap', () => dbg('unmap'));
}
win.connect('close-request', () => {
    win.set_visible(false);
    return true;
});

function armIdle() {
    if (idleId)
        GLib.source_remove(idleId);
    idleId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, IDLE_SECONDS, () => {
        idleId = 0;
        if (win.visible || dragging)
            return GLib.SOURCE_CONTINUE;
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
}

function handle(line) {
    let message;
    try {
        message = JSON.parse(line);
    } catch (e) {
        return;
    }
    switch (message.cmd) {
    case 'show': {
        dbg('show');
        uris = (message.uris ?? []).filter(uri => typeof uri === 'string' && uri.startsWith('file://'));
        if (uris.length === 0)
            return;
        try {
            fileIcon = Gio.File.new_for_uri(uris[0]).query_info('standard::icon', Gio.FileQueryInfoFlags.NONE, null).get_icon();
        } catch (e) {
            fileIcon = Gio.ThemedIcon.new('text-x-generic');
        }
        win.present();
        armIdle();
        break;
    }
    case 'hide':
        dbg(`hide dragging=${dragging}`);
        if (!dragging)
            win.set_visible(false);
        armIdle();
        break;
    case 'quit':
        loop.quit();
        break;
    }
}

// Commands arrive on stdin; end of input means the shell is gone.
const input = new Gio.DataInputStream({base_stream: GioUnix.InputStream.new(0, false)});
function readNext() {
    input.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, result) => {
        let line = null;
        try {
            [line] = stream.read_line_finish_utf8(result);
        } catch (e) {
            line = null;
        }
        if (line === null) {
            loop.quit();
            return;
        }
        handle(line);
        readNext();
    });
}
readNext();
armIdle();
send({ev: 'ready'});
loop.run();
