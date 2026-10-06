import {FilesActivity} from './filesActivity.js';
import {TrayView} from './trayView.js';

/**
 * Owns the tray's view and its Live Activity ("Adding N files…" / "Added N
 * files") for the lifetime of Osmin. The tray is not a widget of the main row:
 * it is the capsule's second mode (the "Tray" tab and the drop target).
 */
export class TrayController {
    constructor({services, settings, dragOut = null}) {
        this._files = services.files;
        this._activities = services.activities;
        this._settings = settings;
        this._activity = new FilesActivity();
        this.view = new TrayView(this._files, dragOut && {
            prepare: uri => dragOut.prepare([uri]),
            begin: () => dragOut.begin(),
            cancel: () => dragOut.cancel(),
        });
    }

    start() {
        this._files.connectObject(
            'adding', (_service, count) => {
                this._activity.setProgress(count, false);
                this._peek(6000);
            },
            'added', (_service, count) => {
                this._activity.setProgress(count, true);
                this._peek(2500);
            },
            this);
    }

    _peek(duration) {
        if (this._settings.get('activity-files'))
            this._activities.peek(this._activity, {duration});
    }

    destroy() {
        this._files.disconnectObject(this);
        this._activity.destroy();
        this.view.destroy();
    }
}
