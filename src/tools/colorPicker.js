import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

Gio._promisify(Shell.Screenshot.prototype, 'pick_color');

const toHex = n => Math.round(n).toString(16).padStart(2, '0').toUpperCase();

/** The text forms of a colour: HEX, RGB and HSL. */
export function colorFormats(red, green, blue) {
    const r = red / 255, g = green / 255, b = blue / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r)
            h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g)
            h = (b - r) / d + 2;
        else
            h = (r - g) / d + 4;
        h *= 60;
    }
    return {
        hex: `#${toHex(red)}${toHex(green)}${toHex(blue)}`,
        rgb: `rgb(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)})`,
        hsl: `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`,
    };
}

/**
 * Pick a colour from anywhere on the screen: the pointer becomes a cross, a click picks the pixel
 * under it (Esc cancels). Nothing stays on screen afterwards.
 * @returns {Promise<{hex: string, rgb: string, hsl: string}|null>} null when cancelled
 */
export function pickColor() {
    return new Promise(resolve => {
        const overlay = new St.Widget({
            reactive: true,
            x: 0,
            y: 0,
            width: global.stage.width,
            height: global.stage.height,
            style: 'background-color: rgba(0, 0, 0, 0.001);',
        });
        Main.uiGroup.add_child(overlay);
        const grab = Main.pushModal(overlay);
        overlay.cursor_type = Clutter.CursorType.CROSSHAIR;

        let done = false;
        const finish = result => {
            if (done)
                return;
            done = true;
            Main.popModal(grab);
            overlay.destroy();
            resolve(result);
        };
        overlay.connect('button-press-event', (_actor, event) => {
            const [x, y] = event.get_coords();
            const screenshot = new Shell.Screenshot();
            // Give the shell a frame without the overlay's cursor change before reading the pixel.
            screenshot.pick_color(x, y).then(([color]) => {
                finish(colorFormats(color.red, color.green, color.blue));
            }).catch(e => {
                console.warn(`[osmin] colour picker: ${e.message}`);
                finish(null);
            });
            return Clutter.EVENT_STOP;
        });
        overlay.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape)
                finish(null);
            return Clutter.EVENT_STOP;
        });
    });
}
