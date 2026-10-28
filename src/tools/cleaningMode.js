import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const AUTO_END_S = 60;      // it ends by itself, whatever happens
const HOLD_ESC_MS = 3000;   // holding Escape ends it earlier

/**
 * Cleaning mode: the screen goes black and the keyboard and the pointer do nothing, so the keys
 * and the screen can be wiped. Holding Escape for 3 seconds ends it; it also ends by itself after
 * a minute.
 * @returns {{end: () => void}}
 */
export function startCleaningMode({onEnd = () => {}} = {}) {
    const overlay = new St.BoxLayout({
        reactive: true,
        vertical: true,
        x: 0,
        y: 0,
        width: global.stage.width,
        height: global.stage.height,
        style: 'background-color: black;',
    });
    const label = new St.Label({
        text: 'Cleaning mode\nHold Esc for 3 seconds to finish',
        style: 'color: rgba(255, 255, 255, 0.45); font-size: 22px; text-align: center;',
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    overlay.add_child(label);
    Main.uiGroup.add_child(overlay);
    const grab = Main.pushModal(overlay);

    let holdId = 0;
    let autoId = 0;
    let ended = false;
    const end = () => {
        if (ended)
            return;
        ended = true;
        if (holdId)
            GLib.source_remove(holdId);
        if (autoId)
            GLib.source_remove(autoId);
        Main.popModal(grab);
        overlay.destroy();
        onEnd();
    };
    overlay.connect('key-press-event', (_actor, event) => {
        if (event.get_key_symbol() === Clutter.KEY_Escape && !holdId) {
            holdId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOLD_ESC_MS, () => {
                holdId = 0;
                end();
                return GLib.SOURCE_REMOVE;
            });
        }
        return Clutter.EVENT_STOP;
    });
    overlay.connect('key-release-event', (_actor, event) => {
        if (event.get_key_symbol() === Clutter.KEY_Escape && holdId) {
            GLib.source_remove(holdId);
            holdId = 0;
        }
        return Clutter.EVENT_STOP;
    });
    autoId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, AUTO_END_S, () => {
        autoId = 0;
        end();
        return GLib.SOURCE_REMOVE;
    });
    return {end};
}
