import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

/**
 * LocalSend, as the interface shows it: the files in the basket, the devices found and the
 * transfers. The work is done by the Osmin service (service/localsend); this mirrors its state and
 * forwards the calls.
 *
 * Signals: 'basket-changed'; 'found' (device) while scanning. A device is
 * {ip, port, protocol, alias, deviceModel, deviceType}.
 */
export class LocalSendService extends Signals.EventEmitter {
    /** @param {ModuleClient} module */
    constructor(module) {
        super();
        this._module = module;
        this._basketKey = '[]';
        this._scanWaiters = [];
        this._sends = new Map(); // id -> {onState, resolve, reject}
        module.connect('state-changed', () => this._onState());
        module.connect('event', (_m, name, payload) => this._onEvent(name, payload));
        module.connect('disconnected', () => this._finishScan());
    }

    /** file:// URIs waiting to be sent */
    get basket() {
        return this._module.state.basket ?? [];
    }

    addToBasket(uris) {
        this._module.call('addToBasket', {uris}).catch(e => console.warn(`[osmin] ${e.message}`));
    }

    removeFromBasket(uris) {
        this._module.call('removeFromBasket', {uris}).catch(e => console.warn(`[osmin] ${e.message}`));
    }

    _onState() {
        const key = JSON.stringify(this.basket);
        if (key !== this._basketKey) {
            this._basketKey = key;
            this.emit('basket-changed');
        }
    }

    /**
     * Looks for devices on the local network; emits 'found' for each.
     * @param {{hosts?: string[]}} [options] hosts: addresses to ask instead of the local subnets
     * @returns {Promise<void>} resolves when the whole subnet was asked (or the scan was cancelled)
     */
    scan({hosts = null} = {}) {
        return new Promise(resolve => {
            this._finishScan();
            this._scanWaiters.push(resolve);
            this._module.call('scan', {hosts}).catch(e => {
                console.warn(`[osmin] LocalSend scan: ${e.message}`);
                this._finishScan();
            });
        });
    }

    cancelScan() {
        if (this._scanWaiters.length > 0)
            this._module.call('cancelScan').catch(() => {});
        this._finishScan();
    }

    _finishScan() {
        const waiters = this._scanWaiters.splice(0);
        for (const resolve of waiters)
            resolve();
    }

    /**
     * Sends files to a device. `onState({phase, sent, total, skipped})`: 'waiting' (until the
     * receiver accepts), 'sending'. Rejects with a short, readable Error.
     * @param {object} device
     * @param {string[]} uris file:// URIs (folders are skipped)
     * @param {{onState?: Function, cancellable?: Gio.Cancellable}} [options]
     * @returns {Promise<{count: number, skipped: number}>}
     */
    async send(device, uris, {onState = () => {}, cancellable = null} = {}) {
        const {id} = await this._module.call('send', {device, uris});
        return new Promise((resolve, reject) => {
            this._sends.set(id, {onState, resolve, reject});
            cancellable?.connect(() => this._module.call('cancelSend', {id}).catch(() => {}));
        });
    }

    _onEvent(name, payload) {
        switch (name) {
        case 'found':
            this.emit('found', payload.device);
            break;
        case 'scanDone':
            this._finishScan();
            break;
        case 'sendState':
            this._sends.get(payload.id)?.onState(payload);
            break;
        case 'sendDone': {
            const send = this._sends.get(payload.id);
            this._sends.delete(payload.id);
            if (!send)
                break;
            if (payload.ok)
                send.resolve({count: payload.count, skipped: payload.skipped});
            else
                send.reject(new Error(payload.message));
            break;
        }
        }
    }

    destroy() {
        this._finishScan();
        for (const send of this._sends.values())
            send.reject(new Error('Cancelled'));
        this._sends.clear();
    }
}
