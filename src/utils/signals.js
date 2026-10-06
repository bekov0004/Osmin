/** Tracks signal connections so they can all be dropped in one call. */
export class SignalTracker {
    constructor() {
        this._connections = [];
    }

    connect(object, name, callback) {
        const id = object.connect(name, callback);
        this._connections.push([object, id]);
        return id;
    }

    disconnectAll() {
        for (const [object, id] of this._connections)
            object.disconnect(id);
        this._connections = [];
    }
}
