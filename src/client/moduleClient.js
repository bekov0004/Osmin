import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

export const BUS_NAME = 'io.github.bekov0004.Osmin';
const RETRY_S = 5;
const CONNECT_WAIT_S = 8;

const MODULE_XML = `<node>
  <interface name="io.github.bekov0004.Osmin.Module">
    <method name="Call">
      <arg type="s" direction="in" name="method"/>
      <arg type="s" direction="in" name="args"/>
      <arg type="s" direction="out" name="result"/>
    </method>
    <method name="GetState">
      <arg type="s" direction="out" name="state"/>
    </method>
    <signal name="StateChanged"><arg type="s" name="state"/></signal>
    <signal name="Event"><arg type="s" name="name"/><arg type="s" name="payload"/></signal>
  </interface>
</node>`;
const ModuleProxy = Gio.DBusProxy.makeProxyWrapper(MODULE_XML);

/**
 * The extension's end of one feature of the Osmin service (see service/module.js): a mirror of the
 * module's state plus a way to call it. The service is started by D-Bus activation the first time
 * it is asked, and may come and go (it ends when the shell is gone, and is restarted when needed):
 * this reconnects by itself.
 *
 * Signals: 'state-changed', 'event' (name, payload), 'connected', 'disconnected'.
 */
export class ModuleClient extends Signals.EventEmitter {
    /** @param {string} name @param {(() => Promise<void>)|null} [ensure] makes sure the service runs */
    constructor(name, ensure = null) {
        super();
        this._name = name;
        this._ensure = ensure;
        this._proxy = null;
        this._state = {};
        this._connected = false;
        this._cancellable = new Gio.Cancellable();
        this._retryId = 0;
    }

    get state() {
        return this._state;
    }

    get connected() {
        return this._connected;
    }

    start() {
        new ModuleProxy(Gio.DBus.session, BUS_NAME, `/io/github/bekov0004/Osmin/${this._name}`, (proxy, error) => {
            if (this._cancellable.is_cancelled())
                return;
            if (error) {
                console.warn(`[osmin] the Osmin service (${this._name}) is not available: ${error.message}`);
                this._retry();
                return;
            }
            this._proxy = proxy;
            proxy.connectSignal('StateChanged', (_p, _sender, [json]) => this._setState(json));
            proxy.connectSignal('Event', (_p, _sender, [name, payload]) => {
                try {
                    this.emit('event', name, JSON.parse(payload));
                } catch (e) {
                    console.warn(`[osmin] bad event ${name} from the service: ${e.message}`);
                }
            });
            proxy.connect('notify::g-name-owner', () => {
                if (proxy.g_name_owner) {
                    this._refresh();
                } else if (this._connected) {
                    this._connected = false;
                    this.emit('disconnected');
                }
            });
            this._refresh();
        }, this._cancellable);
    }

    _retry() {
        if (this._retryId || this._cancellable.is_cancelled())
            return;
        this._retryId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RETRY_S, () => {
            this._retryId = 0;
            this.start();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _refresh() {
        const proxy = this._proxy;
        if (!proxy)
            return;
        try {
            const [json] = await proxy.GetStateAsync();
            this._setState(json);
            if (!this._connected) {
                this._connected = true;
                this.emit('connected');
            }
        } catch (e) {
            if (this._cancellable.is_cancelled())
                return;
            console.warn(`[osmin] reading the state of ${this._name} failed: ${e.message}`);
            // Not started (yet): ask again in a while.
            this._proxy = null;
            this._retry();
        }
    }

    _setState(json) {
        try {
            this._state = JSON.parse(json);
        } catch (e) {
            return;
        }
        this.emit('state-changed');
    }

    /**
     * @param {string} method
     * @param {object} [args]
     * @returns {Promise<object>} the result; rejects with an Error whose message says what went wrong
     */
    async call(method, args = {}) {
        // A service that went away is started again (by the backend); without a proxy yet, wait
        // for the first connection.
        if (this._proxy && !this._proxy.g_name_owner)
            await this._ensure?.();
        if (!this._proxy)
            await this._whenConnected();
        try {
            const [result] = await this._proxy.CallAsync(method, JSON.stringify(args));
            return JSON.parse(result);
        } catch (e) {
            // A remote error reads "GDBus.Error:io.github...Error: message".
            throw new Error(String(e.message).replace(/^GDBus\.Error:[^:]+:\s*/, ''));
        }
    }

    /** The service may still be starting: wait for it a little before giving up. */
    _whenConnected() {
        return new Promise((resolve, reject) => {
            let timer = 0;
            const id = this.connect('connected', () => {
                this.disconnect(id);
                GLib.source_remove(timer);
                resolve();
            });
            timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CONNECT_WAIT_S, () => {
                this.disconnect(id);
                reject(new Error('The Osmin service is not running'));
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    destroy() {
        this._cancellable.cancel();
        if (this._retryId) {
            GLib.source_remove(this._retryId);
            this._retryId = 0;
        }
        this._proxy = null;
    }
}

/** The Osmin service as the extension sees it: one client per feature. */
export class OsminBackend {
    /**
     * @param {{servicePath?: string|null}} [options] servicePath: the service's main.js (in the
     *   extension's folder). Without it the service is only found if something else starts it
     *   (D-Bus activation).
     */
    constructor({servicePath = null} = {}) {
        this._servicePath = servicePath;
        this._ensuring = null;
        this._closing = false;
        const ensure = () => this._ensureService();
        this.service = new ModuleClient('Service', ensure);
        this.localSend = new ModuleClient('LocalSend', ensure);
        this.todo = new ModuleClient('Todo', ensure);
        this.notes = new ModuleClient('Notes', ensure);
        this.timer = new ModuleClient('Timer', ensure);
        this.calendar = new ModuleClient('Calendar', ensure);
        this.files = new ModuleClient('Files', ensure);
        this.artwork = new ModuleClient('Artwork', ensure);
        this.clipboard = new ModuleClient('Clipboard', ensure);
        this.power = new ModuleClient('Power', ensure);
        this.tools = new ModuleClient('Tools', ensure);
        this.focus = new ModuleClient('Focus', ensure);
        this.system = new ModuleClient('System', ensure);
        this.downloads = new ModuleClient('Downloads', ensure);
        this.lyrics = new ModuleClient('Lyrics', ensure);
        this.processes = new ModuleClient('Processes', ensure);
        this.agents = new ModuleClient('Agents', ensure);
        this.snippets = new ModuleClient('Snippets', ensure);
        this.cleaner = new ModuleClient('Cleaner', ensure);
    }

    /** Makes sure the service runs (starts it from the extension's folder if nobody has), once at a time. */
    _ensureService() {
        if (!this._ensuring) {
            this._ensuring = this._startServiceIfNeeded()
                .catch(e => console.warn(`[osmin] could not start the service: ${e.message}`))
                .finally(() => {
                    this._ensuring = null;
                });
        }
        return this._ensuring;
    }

    _hasOwner() {
        return new Promise(resolve => {
            Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner',
                new GLib.Variant('(s)', [BUS_NAME]), null, Gio.DBusCallFlags.NONE, 3000, null, (connection, result) => {
                    try {
                        resolve(connection.call_finish(result).deepUnpack()[0]);
                    } catch (e) {
                        resolve(false);
                    }
                });
        });
    }

    async _startServiceIfNeeded() {
        if (this._closing || !this._servicePath || await this._hasOwner())
            return;
        const gjs = GLib.find_program_in_path('gjs');
        if (!gjs)
            throw new Error('gjs was not found');
        const logDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'osmin']);
        GLib.mkdir_with_parents(logDir, 0o700);
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_SILENCE});
        launcher.setenv('OSMIN_SERVICE', '1', true);
        // What the service says goes to a log file (appended), it has no terminal of its own.
        launcher.spawnv(['/bin/sh', '-c', 'exec "$0" -m "$1" 2>>"$2"', gjs, this._servicePath, `${logDir}/service.log`]);
        await new Promise(resolve => {
            let done = false;
            let timer = 0;
            const finish = () => {
                if (done)
                    return;
                done = true;
                Gio.bus_unwatch_name(watch);
                if (timer)
                    GLib.source_remove(timer);
                resolve();
            };
            const watch = Gio.bus_watch_name(Gio.BusType.SESSION, BUS_NAME, Gio.BusNameWatcherFlags.NONE, finish, null);
            timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 8, () => {
                timer = 0;
                finish();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    start() {
        // Start the service first (when nobody has), then connect to it.
        this._ensureService().then(() => this._connect());
        // If it ever goes away, start it again.
        this.service.connect('disconnected', () => {
            if (!this._closing)
                this._ensureService();
        });
    }

    _connect() {
        if (this._closing)
            return;
        this.service.start();
        this.localSend.start();
        this.todo.start();
        this.notes.start();
        this.timer.start();
        this.calendar.start();
        this.files.start();
        this.artwork.start();
        this.clipboard.start();
        this.power.start();
        this.tools.start();
        this.focus.start();
        this.system.start();
        this.downloads.start();
        this.lyrics.start();
        this.processes.start();
        this.agents.start();
        this.snippets.start();
        this.cleaner.start();
    }

    /** The extension is being disabled: the service has nothing left to do. */
    async shutdown() {
        this._closing = true;
        try {
            await this.service.call('quit');
        } catch (e) {
            // not running
        }
        this.destroy();
    }

    destroy() {
        this.localSend.destroy();
        this.todo.destroy();
        this.notes.destroy();
        this.timer.destroy();
        this.calendar.destroy();
        this.files.destroy();
        this.artwork.destroy();
        this.clipboard.destroy();
        this.power.destroy();
        this.tools.destroy();
        this.focus.destroy();
        this.system.destroy();
        this.downloads.destroy();
        this.lyrics.destroy();
        this.processes.destroy();
        this.agents.destroy();
        this.snippets.destroy();
        this.cleaner.destroy();
        this.service.destroy();
    }
}
