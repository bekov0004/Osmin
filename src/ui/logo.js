import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

/** icons/dev.osmin.Osmin.svg of the extension: the Osmin mark (the island hanging from the top edge). */
export function logoFile() {
    // this file is <extension>/src/ui/logo.js
    const dir = GLib.path_get_dirname(GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0])));
    return Gio.File.new_for_path(`${dir}/icons/dev.osmin.Osmin.svg`);
}

/** The Osmin mark, shown at the top of the quick panel. */
export const Logo = GObject.registerClass(class Logo extends St.Icon {
    _init({size = 40} = {}) {
        super._init({style_class: 'osmin-logo', gicon: new Gio.FileIcon({file: logoFile()}), icon_size: size, x_align: Clutter.ActorAlign.CENTER});
    }
});
