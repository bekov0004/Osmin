/**
 * Base class of everything that lives in a column of the expanded capsule.
 *
 * A widget owns its view and talks to the rest of Osmin through `context`
 * ({events, services, ...}); widgets never import each other.
 *
 * Subclasses set the static `id`, `title` and `iconName`, and implement
 * createView(). Optional hooks: start() (once, when Osmin is enabled; the place
 * to publish live activities), onTick(now), onPageShown(), onPageHidden().
 */
export class OsminWidget {
    static id = 'widget';
    static title = 'Widget';
    static iconName = 'applications-symbolic';

    constructor(context) {
        this.context = context;
        this._view = null;
    }

    /** The St actor shown in the widget's column; created on first use. */
    get view() {
        if (!this._view) {
            this._view = this.createView();
            this.onViewCreated();
        }
        return this._view;
    }

    /** @returns {St.Widget} */
    createView() {
        throw new Error(`${this.constructor.name}.createView() is not implemented`);
    }

    /** The view exists now (a place for the first update; `this.view` is usable). */
    onViewCreated() {}

    /** Called once after construction, whether or not the panel was ever opened. */
    start() {}

    /** @param {GLib.DateTime} _now called when the minute changes */
    onTick(_now) {}

    /** The widget's page became visible (the capsule is open on it). */
    onPageShown() {}

    /** The capsule closed or the user moved to another page. */
    onPageHidden() {}

    destroy() {
        this._view?.destroy();
        this._view = null;
    }
}
