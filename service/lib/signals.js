/**
 * A minimal EventEmitter with the part of GNOME Shell's Signals.EventEmitter the services use
 * (connect / disconnect / emit), so the service modules run in a plain gjs process.
 */
export class EventEmitter {
    connect(name, callback) {
        this._handlers ??= new Map();
        const id = (this._nextHandlerId = (this._nextHandlerId ?? 0) + 1);
        if (!this._handlers.has(name))
            this._handlers.set(name, new Map());
        this._handlers.get(name).set(id, callback);
        return id;
    }

    disconnect(id) {
        for (const handlers of this._handlers?.values() ?? [])
            handlers.delete(id);
    }

    emit(name, ...args) {
        for (const callback of [...(this._handlers?.get(name)?.values() ?? [])]) {
            try {
                callback(this, ...args);
            } catch (e) {
                console.warn(`[osmin-service] handler of '${name}' failed: ${e.message}`);
            }
        }
    }

    // The GNOME Shell version has connectObject(); the service never needs the "owner" part.
    connectObject(...args) {
        const owner = args.pop();
        void owner;
        for (let i = 0; i < args.length; i += 2)
            this.connect(args[i], args[i + 1]);
    }

    disconnectObject() {
        this._handlers?.clear();
    }
}
