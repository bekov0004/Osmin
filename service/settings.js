import Adw from 'gi://Adw?version=1';
import 'gi://Gdk?version=4.0';
import 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * The settings window, as the window of the Osmin app: its own icon and name in the dock and Alt+Tab (not the
 * Extensions app's). The window itself is the one of prefsWindow.js, which the Extensions app shows too.
 */
export async function createSettingsWindow({openStatus}) {
    GLib.set_prgname('dev.osmin.Osmin');
    Adw.init();
    // the extension's folder: this file is <extension>/service/settings.js
    const extensionDir = GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));
    const source = Gio.SettingsSchemaSource.new_from_directory(`${extensionDir}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
    const schema = source.lookup('org.gnome.shell.extensions.osmin', true);
    if (!schema)
        throw new Error(`no settings schema in ${extensionDir}/schemas`);
    const settings = new Gio.Settings({settings_schema: schema});
    let metadata = {};
    try {
        metadata = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${extensionDir}/metadata.json`)[1]));
    } catch (e) {
        // the version is only shown on the About page
    }
    const {OsminPreferences} = await import(`file://${extensionDir}/prefsWindow.js`);
    const window = new Adw.Window();
    new OsminPreferences({settings, metadata, openStatus}).fillPreferencesWindow(window);
    return window;
}
