// Runs in its own process (gjs -m dragout.js <uri>...). GNOME Shell cannot start
// a drag into another application itself, so the shell puts this tiny window
// under the pointer and hands it the mouse press; the window then starts a
// real drag with the files and exits when the drag ends.
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

const uris = ARGV.filter(arg => arg.startsWith('file://'));
Gtk.init();
const loop = new GLib.MainLoop(null, false);

{
    const css = new Gtk.CssProvider();
    css.load_from_string('window.osmin-dragout { background: transparent; } ' +
        'window.osmin-dragout label { color: white; background: rgba(0, 0, 0, 0.6); border-radius: 8px; padding: 0 6px; }');
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

    const win = new Gtk.Window({
        title: 'OsminDragOut',
        decorated: false,
        resizable: false,
        default_width: 140,
        default_height: 140,
        css_classes: ['osmin-dragout'],
    });

    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, halign: Gtk.Align.FILL, valign: Gtk.Align.FILL, hexpand: true, vexpand: true});
    let icon = null;
    try {
        icon = Gio.File.new_for_uri(uris[0]).query_info('standard::icon', Gio.FileQueryInfoFlags.NONE, null).get_icon();
    } catch (e) {
        icon = Gio.ThemedIcon.new('text-x-generic');
    }
    const image = new Gtk.Image({gicon: icon, pixel_size: 56, hexpand: true, vexpand: true});
    box.append(image);
    if (uris.length > 1)
        box.append(new Gtk.Label({label: `${uris.length} files`}));
    win.set_child(box);

    const source = new Gtk.DragSource({actions: Gdk.DragAction.COPY | Gdk.DragAction.LINK});
    source.connect('prepare', () => {
        const list = uris.map(uri => `${uri}\r\n`).join('');
        const paths = uris.map(uri => Gio.File.new_for_uri(uri).get_path()).join('\n');
        const encoder = new TextEncoder();
        return Gdk.ContentProvider.new_union([
            Gdk.ContentProvider.new_for_bytes('text/uri-list', new GLib.Bytes(encoder.encode(list))),
            Gdk.ContentProvider.new_for_bytes('text/plain', new GLib.Bytes(encoder.encode(paths))),
        ]);
    });
    source.connect('drag-begin', () => source.set_icon(Gtk.WidgetPaintable.new(box), 36, 36));
    source.connect('drag-end', () => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    }));
    box.add_controller(source);

    // Never linger: if no drag starts, leave after a while.
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    win.connect('close-request', () => {
        loop.quit();
        return false;
    });
    win.present();
}

loop.run();
