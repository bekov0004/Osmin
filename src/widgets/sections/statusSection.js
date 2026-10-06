import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {createButton} from '../button.js';
import {WorkspaceWidget} from '../workspaceWidget.js';

/**
 * RIGHT section: workspace and the notifications container. (Battery, Wi-Fi,
 * volume etc. are deliberately left to GNOME's own quick settings.)
 */
export class StatusSection extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminStatusSection'}, this);
    }

    constructor({onClose}) {
        super({vertical: true, style_class: 'osmin-section osmin-status-section'});

        const header = new St.BoxLayout({style_class: 'osmin-status-header'});
        this.workspace = new WorkspaceWidget();
        this.workspace.x_expand = true;
        this.workspace.x_align = Clutter.ActorAlign.START;
        header.add_child(this.workspace);
        header.add_child(createButton({
            iconName: 'window-close-symbolic',
            styleClass: 'osmin-close-button',
            onClick: onClose,
        }));
        this.add_child(header);

        // Notifications container; the EventManager will feed it later.
        const notifications = new St.BoxLayout({
            style_class: 'osmin-notifications',
            y_expand: true,
            y_align: Clutter.ActorAlign.END,
        });
        notifications.add_child(new St.Icon({
            icon_name: 'no-notifications-symbolic',
            style_class: 'osmin-notifications-icon',
        }));
        notifications.add_child(new St.Label({
            text: 'No new notifications',
            style_class: 'osmin-notifications-label',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.add_child(notifications);
    }
}
