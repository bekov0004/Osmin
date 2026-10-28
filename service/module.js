import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const MODULE_INTERFACE = 'io.github.bekov0004.Osmin.Module';
const MODULE_XML = `<node>
  <interface name="${MODULE_INTERFACE}">
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

/**
 * One feature of the service. It owns its state (a plain JSON object), changes it in answer to
 * calls (`rpc_<method>(args)` returns a JSON-able result or throws) and tells the clients about
 * it: emitState() sends the whole state, emitEvent() a one-off notice. Everything that goes
 * over D-Bus is JSON text, so a client is a thin mirror of `state`.
 */
export class Module {
    /** @param {string} name the D-Bus object is /io/github/bekov0004/Osmin/<name> */
    constructor(name) {
        this.name = name;
        this._export = null;
        this._host = null;
    }

    /** The JSON-able state the clients mirror. */
    get state() {
        return {};
    }

    /** Called once the service is up. */
    start() {}

    /** Called when the service shuts down. */
    stop() {}

    emitState() {
        this._emit('StateChanged', new GLib.Variant('(s)', [JSON.stringify(this.state)]));
    }

    emitEvent(name, payload = {}) {
        this._emit('Event', new GLib.Variant('(ss)', [name, JSON.stringify(payload)]));
    }

    _emit(signal, parameters) {
        try {
            this._export?.emit_signal(signal, parameters);
        } catch (e) {
            console.warn(`[osmin-service] ${this.name}: sending ${signal} failed: ${e.message}`);
        }
    }

    async dispatch(method, args) {
        const handler = this[`rpc_${method}`];
        if (typeof handler !== 'function')
            throw new Error(`${this.name} has no method ${method}`);
        const result = await handler.call(this, args ?? {});
        return result ?? {};
    }

    /** @param {Gio.DBusConnection} connection @param {{track: (sender: string) => void}} host */
    exportOn(connection, host) {
        this._host = host;
        const module = this;
        const implementation = {
            async CallAsync([method, args], invocation) {
                host.track(invocation.get_sender());
                try {
                    const result = await module.dispatch(method, args === '' ? {} : JSON.parse(args));
                    invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(result)]));
                } catch (e) {
                    invocation.return_dbus_error('io.github.bekov0004.Osmin.Error', String(e.message ?? e));
                }
            },
            async GetStateAsync(_params, invocation) {
                host.track(invocation.get_sender());
                invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(module.state)]));
            },
        };
        this._export = Gio.DBusExportedObject.wrapJSObject(MODULE_XML, implementation);
        this._export.export(connection, `/io/github/bekov0004/Osmin/${this.name}`);
    }

    unexport() {
        this._export?.unexport();
        this._export = null;
    }
}
