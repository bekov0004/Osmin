import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

/**
 * A Live Activity is a short-lived, interactive state of the capsule that
 * belongs to one of Osmin's features (music playing, a timer running, a
 * meeting about to start, files being added).
 *
 * It has two faces, both self-updating (they listen to the activity's
 * 'changed' signal):
 *   - compact parts (one for each side of the camera dot), shown in the
 *     collapsed capsule while the activity is ongoing (registered with
 *     ActivityManager.start());
 *   - a peek view, shown in a card that grows out of the capsule for a few
 *     seconds (ActivityManager.peek()). Clicking its background opens the
 *     panel on the activity's widget (`widgetId`).
 *
 * Subclasses implement createCompactParts() and createPeekView().
 */
export class LiveActivity extends Signals.EventEmitter {
    /**
     * @param {{id: string, widgetId: string, compactPriority?: number}} params
     *   compactPriority: when several activities are ongoing the highest one
     *   is shown in the collapsed capsule.
     */
    constructor({id, widgetId, compactPriority = 0}) {
        super();
        this.id = id;
        this.widgetId = widgetId;
        this.compactPriority = compactPriority;
    }

    /** Short title, used as the card's title. */
    get title() {
        return '';
    }

    /** Size of the peek card in CSS px. */
    get peekSize() {
        return {width: 320, height: 60};
    }

    /** @returns {{left: St.Actor, right: St.Actor}} what goes left and right of the camera dot */
    createCompactParts() {
        throw new Error(`${this.constructor.name}.createCompactParts() is not implemented`);
    }

    /** @returns {St.Actor} */
    createPeekView() {
        throw new Error(`${this.constructor.name}.createPeekView() is not implemented`);
    }

    /** Tells the views (and the capsule) that the content changed. */
    notifyChanged() {
        this.emit('changed');
    }

    destroy() {}
}

/**
 * Compact parts helper: an icon on the left, a text that follows `getText()` on the right.
 * @param {LiveActivity} activity
 * @param {string} iconName
 * @param {() => string} getText
 */
export function createCompactParts(activity, iconName, getText) {
    const icon = new St.Icon({
        icon_name: iconName,
        style_class: 'osmin-compact-icon',
        y_align: Clutter.ActorAlign.CENTER,
    });
    const label = new St.Label({
        text: getText(),
        style_class: 'osmin-compact-label',
        y_align: Clutter.ActorAlign.CENTER,
    });
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    activity.connectObject('changed', () => {
        label.text = getText();
    }, label);
    label.connect('destroy', () => activity.disconnectObject(label));
    return {left: icon, right: label};
}
