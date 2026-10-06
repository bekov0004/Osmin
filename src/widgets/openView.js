import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {ClockWidget} from './clockWidget.js';
import {WorkspaceWidget} from './workspaceWidget.js';
import {createButton} from './button.js';

/** The expanded state: header, clock, workspace info and actions. */
export class OpenView extends St.BoxLayout {
    static {
        GObject.registerClass(this);
    }

    constructor({onClose, onTestNotification}) {
        super({
            vertical: true,
            style_class: 'osmin-open-view',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });

        const header = new St.BoxLayout({style_class: 'osmin-header'});
        header.add_child(new St.Label({
            text: 'Osmin',
            style_class: 'osmin-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        header.add_child(createButton({
            iconName: 'window-close-symbolic',
            styleClass: 'osmin-close-button',
            onClick: onClose,
        }));
        this.add_child(header);

        const body = new St.BoxLayout({style_class: 'osmin-body', y_expand: true});
        this.clock = new ClockWidget();
        this.workspace = new WorkspaceWidget();
        this.workspace.y_align = Clutter.ActorAlign.CENTER;
        body.add_child(this.clock);
        body.add_child(this.workspace);
        this.add_child(body);

        this.add_child(createButton({
            label: 'Test notification',
            iconName: 'object-select-symbolic',
            styleClass: 'osmin-action-button',
            onClick: onTestNotification,
        }));
    }
}
