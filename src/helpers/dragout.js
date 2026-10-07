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
const WINDOW_SIZE = 140;

Gtk.init();
const loop = new GLib.MainLoop(null, false);
const encoder = new TextEncoder();
const stdout = new Gio.DataOutputStream({base_stream: GioUnix.OutputStream.new(1, false)});



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
css.load_from_string('window.osmin-dragout { background: transparent; } ' +
    'window.osmin-dragout label { color: white; background: rgba(0, 0, 0, 0.6); border-radius: 8px; padding: 0 6px; }');
Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

const win = new Gtk.Window({
    title: 'OsminDragOut',
    decorated: false,
    resizable: false,
    default_width: WINDOW_SIZE,
    default_height: WINDOW_SIZE,
    css_classes: ['osmin-dragout'],
});
const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, halign: Gtk.Align.FILL, valign: Gtk.Align.FILL, hexpand: true, vexpand: true});
const image = new Gtk.Image({pixel_size: 56, hexpand: true, vexpand: true});
const count = new Gtk.Label({visible: false});
box.append(image);
box.append(count);
win.set_child(box);

const source = new Gtk.DragSource({actions: Gdk.DragAction.COPY | Gdk.DragAction.LINK});
source.connect('prepare', () => {
    const list = uris.map(uri => `${uri}\r\n`).join('');
    const paths = uris.map(uri => Gio.File.new_for_uri(uri).get_path()).join('\n');
    return Gdk.ContentProvider.new_union([
        Gdk.ContentProvider.new_for_bytes('text/uri-list', new GLib.Bytes(encoder.encode(list))),
        Gdk.ContentProvider.new_for_bytes('text/plain', new GLib.Bytes(encoder.encode(paths))),
    ]);
});
source.connect('drag-begin', () => {
    dragging = true;
    source.set_icon(Gtk.WidgetPaintable.new(box), 36, 36);
    send({ev: 'begin'});
});
source.connect('drag-end', () => {
    dragging = false;
    send({ev: 'end'});
    // Let the drop settle, then get out of the way.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        win.set_visible(false);
        return GLib.SOURCE_REMOVE;
    });
});
box.add_controller(source);
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
        uris = (message.uris ?? []).filter(uri => typeof uri === 'string' && uri.startsWith('file://'));
        if (uris.length === 0)
            return;
        let icon = null;
        try {
            icon = Gio.File.new_for_uri(uris[0]).query_info('standard::icon', Gio.FileQueryInfoFlags.NONE, null).get_icon();
        } catch (e) {
            icon = Gio.ThemedIcon.new('text-x-generic');
        }
        image.set_from_gicon(icon);
        count.set_label(`${uris.length} files`);
        count.set_visible(uris.length > 1);
        win.present();
        armIdle();
        break;
    }
    case 'hide':
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
