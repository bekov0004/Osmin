import GObject from 'gi://GObject';
import St from 'gi://St';

import {scaled} from '../utils/scale.js';

/**
 * Card host for a Live Activity peek view. It follows the card interface the
 * capsule expects (getSize / update / setPending); the content comes from the
 * activity itself (`card.data.activity`).
 */
export class ActivityCard extends St.Bin {
    static {
        GObject.registerClass({GTypeName: 'OsminActivityCard'}, this);
    }

    constructor(card) {
        super({style_class: 'osmin-activity-card', x_expand: true, y_expand: true});
        this._activity = null;
        this.update(card);
    }

    get activity() {
        return this._activity;
    }

    /** Preferred island size in logical px (before UI scaling). */
    getSize() {
        return this._activity?.peekSize ?? {width: 304, height: 54};
    }

    update(card) {
        const activity = card.data?.activity ?? null;
        if (activity === this._activity)
            return;
        this._activity = activity;
        this.child?.destroy();
        this.child = null;
        if (!activity)
            return;
        const view = activity.createPeekView();
        // Leave a margin inside the capsule on both sides.
        view.set_width(scaled(activity.peekSize.width - 32));
        this.child = view;
    }

    setPending(_count) {}
}
