import GObject from 'gi://GObject';
import St from 'gi://St';

import {encodeQr} from '../utils/qr.js';

const QUIET = 2; // modules of white around the code

/** A QR code drawn on a white rounded square. setText() makes it, clear() empties it. */
export const QrCode = GObject.registerClass(class QrCode extends St.DrawingArea {
    _init(size = 196) {
        super._init({style_class: 'osmin-qr', width: size, height: size, x_align: 3 /* CENTER */});
        this._qr = null;
        this.connect('repaint', area => this._paint(area));
    }

    setText(text) {
        try {
            this._qr = text ? encodeQr(text) : null;
        } catch (e) {
            console.warn(`[osmin] QR code: ${e.message}`);
            this._qr = null;
        }
        this.queue_repaint();
    }

    clear() {
        this.setText('');
    }

    _paint(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const radius = 14;
        cr.setSourceRGB(1, 1, 1);
        cr.newSubPath();
        cr.arc(width - radius, radius, radius, -Math.PI / 2, 0);
        cr.arc(width - radius, height - radius, radius, 0, Math.PI / 2);
        cr.arc(radius, height - radius, radius, Math.PI / 2, Math.PI);
        cr.arc(radius, radius, radius, Math.PI, 3 * Math.PI / 2);
        cr.closePath();
        cr.fill();
        if (this._qr) {
            const total = this._qr.size + QUIET * 2;
            const cell = Math.floor(Math.min(width, height) / total);
            const offsetX = Math.floor((width - cell * this._qr.size) / 2);
            const offsetY = Math.floor((height - cell * this._qr.size) / 2);
            cr.setSourceRGB(0, 0, 0);
            for (let y = 0; y < this._qr.size; y++) {
                for (let x = 0; x < this._qr.size; x++) {
                    if (this._qr.get(x, y))
                        cr.rectangle(offsetX + x * cell, offsetY + y * cell, cell, cell);
                }
            }
            cr.fill();
        }
        cr.$dispose();
    }
});
