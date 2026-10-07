import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

/**
 * The notifications the shell is holding right now (the same list the date menu
 * shows), plus Do Not Disturb. Nothing is stored by Osmin: the list is the shell's
 * own, so it is empty after a restart, like GNOME's. Signal: 'changed'.
 */
export class NotificationsService extends Signals.EventEmitter {
    constructor() {
        super();
        this._sources = new Set();
        this._settings = null;
        this._changedId = 0;
    }

    start() {
        this._settings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._settings.connectObject('changed::show-banners', () => this.emit('changed'), this);
        const tray = Main.messageTray;
        tray.connectObject(
            'source-added', (_t, source) => this._watch(source),
            'source-removed', (_t, source) => this._unwatch(source),
            this);
        for (const source of tray.getSources())
            this._watch(source);
    }

    destroy() {
        if (this._changedId) {
            GLib.source_remove(this._changedId);
            this._changedId = 0;
        }
        Main.messageTray?.disconnectObject(this);
        for (const source of this._sources)
            source.disconnectObject(this);
        this._sources.clear();
        this._settings?.disconnectObject(this);
        this._settings = null;
    }

    /** Do Not Disturb: banners are off. */
    get dnd() {
        return this._settings ? !this._settings.get_boolean('show-banners') : false;
    }

    set dnd(value) {
        this._settings?.set_boolean('show-banners', !value);
    }

    /** [{notification, source, title, body, time}] newest first */
    get items() {
        const result = [];
        for (const source of this._sources) {
            for (const notification of source.notifications ?? []) {
                result.push({
                    notification,
                    source,
                    app: source.title ?? '',
                    title: notification.title ?? '',
                    body: notification.body ?? '',
                    gicon: notification.gicon ?? source.icon ?? null,
                    time: notification.datetime?.to_unix() ?? 0,
                });
            }
        }
        return result.sort((a, b) => b.time - a.time);
    }

    /** Opens the app behind the notification (the shell's own action) and removes it. */
    activate(item) {
        try {
            item.notification.activate();
        } catch (e) {
            console.warn(`[osmin] notification activate failed: ${e.message}`);
        }
    }

    dismiss(item) {
        try {
            item.notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
        } catch (e) {
            console.warn(`[osmin] notification dismiss failed: ${e.message}`);
        }
    }

    clear() {
        for (const item of this.items)
            this.dismiss(item);
    }

    _watch(source) {
        if (this._sources.has(source))
            return;
        this._sources.add(source);
        source.connectObject(
            'notification-added', () => this._changed(),
            'notification-removed', () => this._changed(),
            'destroy', () => this._unwatch(source),
            this);
        this._changed();
    }

    _unwatch(source) {
        if (!this._sources.delete(source))
            return;
        source.disconnectObject(this);
        this._changed();
    }

    // Removing a source's last notification also destroys the source: tell the view once.
    _changed() {
        if (this._changedId)
            return;
        this._changedId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            this._changedId = 0;
            this.emit('changed');
            return GLib.SOURCE_REMOVE;
        });
    }
}
