import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

/**
 * One incoming transfer, as the card shows it: who sends what, and what became of it. The user
 * decides with accept() / decline(); the service then receives the files.
 * Signal: 'changed'. state: asking | receiving | done | failed | declined
 */
export class IncomingTransfer extends Signals.EventEmitter {
    constructor(module, {id, sender, files, total, folder}) {
        super();
        this._module = module;
        this.id = id;
        this.sender = sender;           // {alias, deviceModel, deviceType}
        this.files = files.map(file => ({...file, path: null}));
        this.total = total;
        this.received = 0;
        this.folder = folder;
        this.state = 'asking';
        this.error = '';
    }

    accept() {
        if (this.state !== 'asking')
            return;
        this.state = 'receiving';
        this.emit('changed');
        this._module.call('acceptIncoming', {id: this.id}).catch(e => this._failed(e.message));
    }

    decline() {
        if (this.state === 'asking')
            this.state = 'declined';
        else if (this.state === 'receiving')
            this.state = 'failed', this.error = 'Cancelled';
        this.emit('changed');
        this._module.call('declineIncoming', {id: this.id}).catch(() => {});
    }

    _failed(message) {
        if (this.state === 'done')
            return;
        this.state = 'failed';
        this.error = message;
        this.emit('changed');
    }

    /** What the service reports: {state, received, total, error, paths} */
    update(report) {
        this.state = report.state;
        this.received = report.received;
        this.total = report.total;
        this.error = report.error ?? '';
        report.paths?.forEach((path, index) => {
            if (this.files[index])
                this.files[index].path = path;
        });
        this.emit('changed');
    }
}

/**
 * Receiving files with LocalSend, switched on and off by the setting. The server itself runs in
 * the Osmin service; this relays the requests of the devices as 'incoming' transfers.
 *
 * Signal: 'incoming' (IncomingTransfer)
 */
export class LocalSendServer extends Signals.EventEmitter {
    /** @param {ModuleClient} module */
    constructor(module) {
        super();
        this._module = module;
        this._transfers = new Map();
        module.connect('event', (_m, name, payload) => this._onEvent(name, payload));
    }

    get running() {
        return !!this._module.state.receiving;
    }

    /** @returns {Promise<string|null>} null when it runs, otherwise why it does not */
    async start() {
        try {
            const {problem} = await this._module.call('setReceiving', {on: true});
            return problem ?? null;
        } catch (e) {
            return e.message;
        }
    }

    stop() {
        this._module.call('setReceiving', {on: false}).catch(() => {});
    }

    _onEvent(name, payload) {
        if (name === 'incoming') {
            const transfer = new IncomingTransfer(this._module, payload);
            this._transfers.set(payload.id, transfer);
            this.emit('incoming', transfer);
        } else if (name === 'incomingState') {
            const transfer = this._transfers.get(payload.id);
            transfer?.update(payload);
            if (['done', 'failed', 'declined'].includes(payload.state))
                this._transfers.delete(payload.id);
        }
    }

    destroy() {
        this._transfers.clear();
    }
}
