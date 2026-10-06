import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {createButton} from './button.js';
import {CalendarSection} from './sections/calendarSection.js';
import {MediaSection} from './sections/mediaSection.js';
import {StatusSection} from './sections/statusSection.js';

function divider() {
    return new St.Widget({style_class: 'osmin-divider', y_expand: true});
}

/**
 * The expanded capsule: LEFT / CENTER / RIGHT sections side by side and,
 * optionally, a temporary strip of test actions ({label, onClick}).
 * Its width is set from outside (it adapts to the monitor); the natural
 * height follows from the content.
 */
export class OpenView extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminOpenView'}, this);
    }

    constructor({onClose, debugActions = []}) {
        super({
            vertical: true,
            style_class: 'osmin-open-view',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });

        this._media = new MediaSection();
        this._calendar = new CalendarSection();
        this._status = new StatusSection({onClose});

        const row = new St.BoxLayout({style_class: 'osmin-sections', x_expand: true});
        row.add_child(this._media);
        row.add_child(divider());
        row.add_child(this._calendar);
        row.add_child(divider());
        row.add_child(this._status);
        this.add_child(row);

        if (debugActions.length > 0)
            this._addDebugActions(debugActions);
    }

    /** @param {GLib.DateTime} now */
    updateClock(now) {
        this._calendar.update(now);
    }

    updateWorkspace(info) {
        this._status.workspace.update(info);
    }

    /** Height in px the content needs at the given width. */
    getHeightForWidth(width) {
        return this.get_preferred_height(width)[1];
    }

    _addDebugActions(actions) {
        const strip = new St.BoxLayout({style_class: 'osmin-debug-strip', x_expand: true});
        for (const action of actions) {
            strip.add_child(createButton({
                label: action.label,
                styleClass: 'osmin-debug-button',
                expand: true,
                onClick: action.onClick,
            }));
        }
        this.add_child(strip);
    }
}
