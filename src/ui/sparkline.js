import GObject from 'gi://GObject';
import St from 'gi://St';

/**
 * A small graph of the last readings: a filled line, and optionally a dotted line at the top with
 * its label ("100%", "5.0 MB/s"). Set the numbers with setValues().
 */
export const Sparkline = GObject.registerClass(class Sparkline extends St.DrawingArea {
    /**
     * @param {{color?: number[], max?: number|null, height?: number, label?: (max: number) => string}} options
     *   color: [r, g, b] 0..1; max: fixed top of the scale, or null to fit the data
     */
    _init({color = [0.04, 0.52, 1], max = null, height = 44, label = null} = {}) {
        super._init({style_class: 'osmin-sparkline', x_expand: true, height});
        this._color = color;
        this._max = max;
        this._label = label;
        this._values = [];
        this.connect('repaint', area => this._paint(area));
    }

    setValues(values) {
        this._values = values ?? [];
        this._extra = [];
        this.queue_repaint();
    }

    /** Draws several lines on one scale: [{values, color}], the first one is the main one. */
    setSeries(series) {
        this._values = series[0]?.values ?? [];
        this._colors = series.map(s => s.color);
        this._extra = series;
        this.queue_repaint();
    }

    /** The highest value of everything drawn (what the dotted line stands for). */
    get peak() {
        const all = this._extra?.length ? this._extra.flatMap(s => s.values) : this._values;
        return this._max ?? Math.max(1, ...all) * 1.15;
    }

    _paint(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const values = this._values;
        let top = this.peak;
        if (top <= 0)
            top = 1;

        // The dotted top line.
        if (this._label) {
            cr.setSourceRGBA(1, 1, 1, 0.18);
            cr.setLineWidth(1);
            cr.setDash([2, 3], 0);
            cr.moveTo(0, 0.5);
            cr.lineTo(width, 0.5);
            cr.stroke();
            cr.setDash([], 0);
        }

        const lines = this._extra?.length ? this._extra : [{values, color: this._color}];
        lines.forEach((line, index) => {
            const data = line.values;
            if (data.length < 2)
                return;
            const [r, g, b] = line.color;
            const step = width / Math.max(data.length - 1, 1);
            const y = v => height - 2 - Math.min(Math.max(v / top, 0), 1) * (height - 4);
            cr.moveTo(0, y(data[0]));
            data.forEach((v, i) => cr.lineTo(i * step, y(v)));
            cr.setSourceRGBA(r, g, b, 1);
            cr.setLineWidth(1.5);
            cr.stroke();
            if (index === 0 || lines.length === 1) {
                cr.moveTo(0, height);
                data.forEach((v, i) => cr.lineTo(i * step, y(v)));
                cr.lineTo((data.length - 1) * step, height);
                cr.closePath();
                cr.setSourceRGBA(r, g, b, 0.18);
                cr.fill();
            }
        });
        cr.$dispose();
    }

    get topLabel() {
        return this._label ? this._label(this.peak) : '';
    }
});
