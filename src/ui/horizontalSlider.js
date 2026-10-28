import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * A thin horizontal slider: the left is `min`, the right is `max`. A press or a drag on the
 * track sets the value; it follows the pointer even when it leaves the track; the wheel steps it.
 */
export class HorizontalSlider extends St.Widget {
    static {
        GObject.registerClass({GTypeName: 'OsminHorizontalSlider'}, this);
    }

    /** @param {{min: number, max: number, value: number, onChange: (value: number) => void}} params */
    constructor({min, max, value, onChange}) {
        super({
            style_class: 'osmin-hslider',
            layout_manager: new Clutter.FixedLayout(),
            reactive: true,
            track_hover: true,
            x_expand: true,
        });
        this._min = min;
        this._max = max;
        this._value = clamp(value, min, max);
        this._onChange = onChange;
        this._grab = null;

        this._track = new St.Widget({style_class: 'osmin-hslider-track'});
        this._fill = new St.Widget({style_class: 'osmin-hslider-fill'});
        this._thumb = new St.Widget({style_class: 'osmin-hslider-thumb'});
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
        if (this._grab)
            return; // the user is dragging: what the system reports meanwhile must not fight them
        this._value = clamp(value, this._min, this._max);
        this._layout();
    }

    set max(max) {
        this._max = max;
        this._layout();
    }

    _fraction() {
        return (this._value - this._min) / (this._max - this._min);
    }

    _layout() {
        const [width, height] = this.get_size();
        const thumb = this._thumb.get_height() || height;
        const room = Math.max(1, width - thumb);
        const x = Math.round(this._fraction() * room);
        const trackHeight = this._track.get_height() || 4;
        this._track.set_size(width, trackHeight);
        this._track.set_position(0, Math.round((height - trackHeight) / 2));
        this._thumb.set_position(x, Math.round((height - thumb) / 2));
        this._fill.set_height(trackHeight);
        this._fill.set_position(0, Math.round((height - trackHeight) / 2));
        this._fill.set_width(Math.max(0, x + thumb / 2));
    }

    _setFromEvent(event) {
        const [x, y] = event.get_coords();
        const [ok, local] = this.transform_stage_point(x, y);
        if (!ok)
            return;
        const thumb = this._thumb.get_height() || 1;
        const room = Math.max(1, this.get_width() - thumb);
        const fraction = clamp((local - thumb / 2) / room, 0, 1);
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
        case Clutter.ScrollDirection.RIGHT:
            step = 1;
            break;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.LEFT:
            step = -1;
            break;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
        this._value = clamp(this._value + step * (this._max - this._min) / 20, this._min, this._max);
        this._layout();
        this._onChange(this._value);
        return Clutter.EVENT_STOP;
    }
}
