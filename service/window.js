import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

/**
 * The window of the Osmin app: shows what the service is doing and has the few buttons that belong
 * to the app itself. The capsule and its settings are in the GNOME Shell extension; this window
 * only helps to see that everything is running.
 */
export function createWindow(application, modules, {restart, openScratchpad}) {
    // The service is a plain Gio.Application (no Gtk.Application): start GTK by hand, and say which
    // desktop file the window belongs to.
    GLib.set_prgname('dev.osmin.Osmin');
    Adw.init();
    const window = new Adw.Window({
        title: 'Osmin',
        default_width: 460,
        default_height: 640,
    });

    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(new Adw.HeaderBar());

    const page = new Adw.PreferencesPage();
    const status = new Adw.PreferencesGroup({
        title: 'Service',
        description: 'Osmin is a GNOME Shell extension (the capsule) and this service, which does the work that waits or talks to the network.',
    });
    page.add(status);

    const running = new Adw.ActionRow({title: 'Running', subtitle: `process ${new TextDecoder().decode(GLib.file_get_contents('/proc/self/stat')[1]).split(' ')[0]}`});
    running.add_prefix(new Gtk.Image({icon_name: 'emblem-ok-symbolic'}));
    status.add(running);

    const features = new Adw.PreferencesGroup({title: 'Features'});
    page.add(features);
    const describe = {
        LocalSend: m => (m.state.receiving ? 'Receiving files is on' : 'Receiving files is off') +
            (m.state.basket.length > 0 ? `, ${m.state.basket.length} files waiting to be sent` : ''),
        Todo: m => `${m.state.items.length} tasks`,
        Notes: m => `${m.state.notes.length} notes`,
        Timer: m => m.state.state,
        Calendar: m => (m.state.hasCalendars ? `${m.state.events.length} events in the asked window` : 'No calendars set up'),
        Files: m => `${m.state.items.length} files in the tray`,
        Artwork: () => 'Downloads album covers',
        Clipboard: () => 'Keeps the clipboard history on disk',
    };
    for (const module of modules) {
        if (!describe[module.name])
            continue;
        let subtitle = '';
        try {
            subtitle = describe[module.name](module);
        } catch (e) {
            subtitle = 'ready';
        }
        features.add(new Adw.ActionRow({title: module.name, subtitle}));
    }

    const actions = new Adw.PreferencesGroup();
    page.add(actions);
    const settings = new Adw.ActionRow({title: 'Osmin settings', subtitle: 'Opens the settings of the extension', activatable: true});
    settings.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
    settings.connect('activated', () => {
        try {
            Gio.Subprocess.new(['gnome-extensions', 'prefs', 'osmin@osmin.dev'], Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.warn(`[osmin-service] cannot open the settings: ${e.message}`);
        }
    });
    actions.add(settings);
    const scratch = new Adw.ActionRow({title: 'Scratchpad', subtitle: 'Notes of any length, saved as you type', activatable: true});
    scratch.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
    scratch.connect('activated', () => openScratchpad());
    actions.add(scratch);
    const again = new Adw.ActionRow({title: 'Restart the service', subtitle: 'It starts again by itself when the extension needs it', activatable: true});
    again.connect('activated', () => restart());
    actions.add(again);

    toolbar.set_content(page);
    window.set_content(toolbar);
    return window;
}
