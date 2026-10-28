import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Module} from '../module.js';
import {LocalSendService} from './localSendService.js';
import {LocalSendServer} from './localSendServer.js';

/**
 * LocalSend for the extension: finding devices, sending the basket, receiving files.
 *
 * state:   {basket: [uri], receiving: bool, receiveError: string|null}
 * events:  found {device}, scanDone {}, sendState {id, phase, sent, total, skipped},
 *          sendDone {id, ok, message, count, skipped}, incoming {id, sender, files, total, folder},
 *          incomingState {id, state, received, total, error, paths}
 */
export class LocalSendModule extends Module {
    constructor() {
        super('LocalSend');
        this._service = new LocalSendService();
        this._server = new LocalSendServer(this._service);
        this._sends = new Map();       // id -> Gio.Cancellable
        this._incoming = new Map();    // id -> IncomingTransfer
        this._nextSend = 1;
        this._receiving = false;
        this._receiveError = null;

        this._service.connect('basket-changed', () => this.emitState());
        this._service.connect('found', (_s, device) => this.emitEvent('found', {device}));
        this._server.connect('incoming', (_s, transfer) => this._onIncoming(transfer));
    }

    get state() {
        return {basket: this._service.basket, receiving: this._receiving, receiveError: this._receiveError};
    }

    stop() {
        this._service.cancelScan();
        for (const cancellable of this._sends.values())
            cancellable.cancel();
        this._server.stop();
    }

    // --- the basket ------------------------------------------------------------

    async rpc_addToBasket({uris = []}) {
        this._service.addToBasket(uris.filter(uri => typeof uri === 'string'));
    }

    async rpc_removeFromBasket({uris = []}) {
        this._service.removeFromBasket(uris);
    }

    // --- finding devices -----------------------------------------------------

    /** Starts looking (answers at once); the devices arrive as 'found' events, the end as 'scanDone'. */
    async rpc_scan({hosts = null}) {
        this._service.scan({hosts}).then(() => this.emitEvent('scanDone'));
    }

    async rpc_cancelScan() {
        this._service.cancelScan();
        this.emitEvent('scanDone');
    }

    // --- sending ---------------------------------------------------------------

    async rpc_send({device, uris = []}) {
        const id = this._nextSend++;
        const cancellable = new Gio.Cancellable();
        this._sends.set(id, cancellable);
        this._service.cancelScan();
        // After the answer: the client must know the id before the first event about it arrives.
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._service.send(device, uris, {
                cancellable,
                onState: state => this.emitEvent('sendState', {id, ...state}),
            }).then(result => {
                this.emitEvent('sendDone', {id, ok: true, message: '', count: result.count, skipped: result.skipped});
            }, e => {
                this.emitEvent('sendDone', {id, ok: false, message: e.message, count: 0, skipped: 0});
            }).finally(() => this._sends.delete(id));
            return GLib.SOURCE_REMOVE;
        });
        return {id};
    }

    async rpc_cancelSend({id}) {
        this._sends.get(id)?.cancel();
    }

    // --- receiving -------------------------------------------------------------

    async rpc_setReceiving({on}) {
        if (on) {
            this._receiveError = await this._server.start();
            this._receiving = this._receiveError === null;
        } else {
            this._server.stop();
            this._receiving = false;
            this._receiveError = null;
        }
        this.emitState();
        return {problem: this._receiveError};
    }

    _onIncoming(transfer) {
        this._incoming.set(transfer.sessionId, transfer);
        const report = () => this.emitEvent('incomingState', {
            id: transfer.sessionId,
            state: transfer.state,
            received: transfer.received,
            total: transfer.total,
            error: transfer.error,
            paths: transfer.files.map(file => file.path).filter(Boolean),
        });
        transfer.connect('changed', () => {
            report();
            if (['done', 'failed', 'declined'].includes(transfer.state))
                this._incoming.delete(transfer.sessionId);
        });
        this.emitEvent('incoming', {
            id: transfer.sessionId,
            sender: transfer.sender,
            files: transfer.files.map(file => ({name: file.name, size: file.size})),
            total: transfer.total,
            folder: transfer.folder,
        });
    }

    async rpc_acceptIncoming({id}) {
        this._incoming.get(id)?.accept();
    }

    async rpc_declineIncoming({id}) {
        this._incoming.get(id)?.decline();
    }
}
