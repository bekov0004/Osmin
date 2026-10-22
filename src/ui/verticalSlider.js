import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * A thin vertical slider: the top is `max`, the bottom is `min`. A press or a drag on the
 * track sets the value; it follows the pointer even when it leaves the track.
 */
export class VerticalSlider extends St.Widget {
    static {
        GObject.registerClass({GTypeName: 'OsminVerticalSlider'}, this);
    }

    /** @param {{min: number, max: number, value: number, onChange: (value: number) => void}} params */
    constructor({min, max, value, onChange}) {
        super({
            style_class: 'osmin-vslider',
            layout_manager: new Clutter.FixedLayout(),
            reactive: true,
            track_hover: true,
        });
        this._min = min;
        this._max = max;
        this._value = clamp(value, min, max);
        this._onChange = onChange;
        this._grab = null;

        this._track = new St.Widget({style_class: 'osmin-vslider-track'});
        this._fill = new St.Widget({style_class: 'osmin-vslider-fill'});
        this._thumb = new St.Widget({style_class: 'osmin-vslider-thumb'});
        this.add_child(this._track);
        this.add_child(this._fill);
        this.add_child(this._thumb);
        this.connect('notify::allocation', () => this._layout());
        this.connect('button-press-event', (_a, event) => this._begin(event));
        this.connect('motion-event', (_a, event) => this._drag(event));
        this.connect('button-release-event', () => this._end());
        this.connect('scroll-event', (_a, event) => this._scroll(event));
        this.connect('destroy', () => this._end());
    }

    get value() {
        return this._value;
    }

    set value(value) {
        this._value = clamp(value, this._min, this._max);
        this._layout();
    }

    _fraction() {
        return (this._value - this._min) / (this._max - this._min);
    }

    _layout() {
        const [width, height] = this.get_size();
        const thumb = this._thumb.get_width() || width;
        const room = Math.max(1, height - thumb);
        const y = Math.round((1 - this._fraction()) * room);
        this._track.set_size(this._track.get_width() || 3, height);
        this._track.set_position(Math.round((width - (this._track.get_width() || 3)) / 2), 0);
        this._thumb.set_position(Math.round((width - thumb) / 2), y);
        this._fill.set_position(Math.round((width - this._fill.get_width()) / 2), y + thumb / 2);
        this._fill.set_height(Math.max(0, height - y - thumb / 2));
    }

    _setFromEvent(event) {
        const [x, y] = event.get_coords();
        const [ok, , local] = this.transform_stage_point(x, y);
        if (!ok)
            return;
        const thumb = this._thumb.get_width() || 1;
        const room = Math.max(1, this.get_height() - thumb);
        const fraction = 1 - clamp((local - thumb / 2) / room, 0, 1);
        this._value = this._min + fraction * (this._max - this._min);
        this._layout();
        this._onChange(this._value);
    }

    _begin(event) {
        if (!this._grab)
            this._grab = global.stage.grab(this);
        this._setFromEvent(event);
        return Clutter.EVENT_STOP;
    }

    _drag(event) {
        if (!this._grab)
            return Clutter.EVENT_PROPAGATE;
        this._setFromEvent(event);
        return Clutter.EVENT_STOP;
    }

    _end() {
        this._grab?.dismiss();
        this._grab = null;
        return Clutter.EVENT_STOP;
    }

    _scroll(event) {
        let step = 0;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
            step = 1;
            break;
        case Clutter.ScrollDirection.DOWN:
            step = -1;
            break;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
        this.value = this._value + step * (this._max - this._min) / 20;
        this._onChange(this._value);
        return Clutter.EVENT_STOP;
    }
}
