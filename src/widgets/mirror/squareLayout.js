import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

/**
 * Lays one child out as the largest centred square that fits, and reports no
 * preferred size of its own. The square therefore never feeds back into the
 * size of the column it lives in (sizing the circle from its own parent made it
 * shrink a little every time the panel was opened).
 */
export const SquareLayout = GObject.registerClass(
class OsminSquareLayout extends Clutter.LayoutManager {
    constructor(margin = 4) {
        super();
        this._margin = margin;
    }

    vfunc_get_preferred_width() {
        return [0, 0];
    }

    vfunc_get_preferred_height() {
        return [0, 0];
    }

    vfunc_allocate(container, box) {
        const child = container.get_first_child();
        if (!child)
            return;
        const side = Math.max(Math.floor(Math.min(box.get_width(), box.get_height())) - this._margin, 0);
        const x = box.x1 + Math.floor((box.get_width() - side) / 2);
        const y = box.y1 + Math.floor((box.get_height() - side) / 2);
        const childBox = new Clutter.ActorBox();
        childBox.init_rect(x, y, side, side);
        child.allocate(childBox);
    }
});
