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
 *   - a compact view, shown in the collapsed capsule while the activity is
 *     ongoing (registered with ActivityManager.start());
 *   - a peek view, shown in a card that grows out of the capsule for a few
 *     seconds (ActivityManager.peek()). Clicking its background opens the
 *     panel on the activity's widget (`widgetId`).
 *
 * Subclasses implement createCompactView() and createPeekView().
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

    /** @returns {St.Actor} */
    createCompactView() {
        throw new Error(`${this.constructor.name}.createCompactView() is not implemented`);
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
 * Compact view helper: an icon followed by a text that follows `getText()`.
 * @param {LiveActivity} activity
 * @param {string} iconName
 * @param {() => string} getText
 */
export function createCompactRow(activity, iconName, getText) {
    const row = new St.BoxLayout({style_class: 'osmin-compact'});
    row.add_child(new St.Icon({
        icon_name: iconName,
        style_class: 'osmin-compact-icon',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    const label = new St.Label({
        text: getText(),
        style_class: 'osmin-compact-label',
        y_align: Clutter.ActorAlign.CENTER,
    });
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    row.add_child(label);
    activity.connectObject('changed', () => {
        label.text = getText();
    }, row);
    row.connect('destroy', () => activity.disconnectObject(row));
    return row;
}
