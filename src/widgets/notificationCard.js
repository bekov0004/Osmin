import GObject from 'gi://GObject';

import {OsminCard} from './osminCard.js';

/** Card for `notification` events (and the fallback for types without a card of their own). */
export class NotificationCard extends OsminCard {
    static {
        GObject.registerClass({GTypeName: 'OsminNotificationCard'}, this);
    }

    constructor(card) {
        super(card);
        this.add_style_class_name('osmin-notification-card');
    }
}
