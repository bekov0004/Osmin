#!/usr/bin/env -S gjs -m
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import System from 'system';

import {Module} from './module.js';
import {ArtworkModule} from './artwork/module.js';
import {CalendarModule} from './calendar/module.js';
import {ClipboardModule} from './clipboard/module.js';
import {FilesModule} from './files/module.js';
import {LocalSendModule} from './localsend/module.js';
import {NotesModule} from './notes/module.js';
import {TimerModule} from './timer/module.js';
import {TodoModule} from './todo/module.js';

export const APPLICATION_ID = 'io.github.bekov0004.Osmin';
const VERSION = '1';
const IDLE_QUIT_S = 20; // no client left (the shell went away): the service ends

/** The service itself: answers ping, and quits on request. */
class ServiceModule extends Module {
    constructor(app) {
        super('Service');
        this._app = app;
    }

    get state() {
        return {version: VERSION, pid: Number(new TextDecoder().decode(GLib.file_get_contents('/proc/self/stat')[1]).split(' ')[0])};
    }

    async rpc_ping() {
        return {version: VERSION};
    }

    async rpc_quit() {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._app.quit();
            return GLib.SOURCE_REMOVE;
        });
        return {};
    }
}

/**
 * Osmin's background service. The GNOME Shell extension is only the face of Osmin; everything that
 * waits, scans the network or writes files runs here, in a process of its own, so that it can
 * never freeze the desktop and can be restarted without logging out. It is started by D-Bus
 * activation the first time the extension asks for it and ends when no client is left.
 */
const OsminService = GObject.registerClass(class OsminService extends Gio.Application {
    constructor() {
        super({application_id: APPLICATION_ID, flags: Gio.ApplicationFlags.IS_SERVICE});
        this._modules = [new ServiceModule(this), new LocalSendModule(), new TodoModule(), new NotesModule(), new TimerModule(), new CalendarModule(), new FilesModule(), new ArtworkModule(), new ClipboardModule()];
        this._clients = new Map(); // unique bus name -> watch id
        this._idleId = 0;
    }

    vfunc_dbus_register(connection, objectPath) {
        const result = super.vfunc_dbus_register(connection, objectPath);
        this._connection = connection;
        const host = {track: sender => this._track(sender)};
        for (const module of this._modules)
            module.exportOn(connection, host);
        return result;
    }

    vfunc_dbus_unregister(connection, objectPath) {
        for (const module of this._modules)
            module.unexport();
        super.vfunc_dbus_unregister(connection, objectPath);
    }

    vfunc_startup() {
        super.vfunc_startup();
        this.hold();
        for (const module of this._modules)
            module.start();
        this._armIdle();
    }

    vfunc_shutdown() {
        for (const module of this._modules)
            module.stop();
        super.vfunc_shutdown();
    }

    vfunc_activate() {}

    /** Remembers who talks to us; when all of them are gone, the service ends after a while. */
    _track(sender) {
        if (!sender || this._clients.has(sender))
            return;
        this._cancelIdle();
        const watch = Gio.bus_watch_name_on_connection(this._connection, sender, Gio.BusNameWatcherFlags.NONE, null, () => {
            Gio.bus_unwatch_name(watch);
            this._clients.delete(sender);
            if (this._clients.size === 0)
                this._armIdle();
        });
        this._clients.set(sender, watch);
    }

    _armIdle() {
        this._cancelIdle();
        this._idleId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, IDLE_QUIT_S, () => {
            this._idleId = 0;
            if (this._clients.size === 0)
                this.quit();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelIdle() {
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
    }
});

new OsminService().run([System.programInvocationName, ...ARGV]);
