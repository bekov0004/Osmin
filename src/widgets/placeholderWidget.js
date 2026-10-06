import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {OsminWidget} from './widget.js';

/** A column with an icon and a title for widgets that are not built yet. */
export class PlaceholderWidget extends OsminWidget {
    createView() {
        const box = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-widget osmin-placeholder',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(new St.Icon({
            icon_name: this.constructor.iconName,
            style_class: 'osmin-placeholder-icon',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(new St.Label({
            text: this.constructor.title,
            style_class: 'osmin-placeholder-title',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        return box;
    }
}
