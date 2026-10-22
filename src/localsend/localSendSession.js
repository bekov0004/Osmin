import Gio from 'gi://Gio';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const STALE_MS = 60 * 1000; // a device list older than this is searched again when the section opens

/**
 * What the LocalSend section shows and does: the devices found on the network, the basket of
 * files waiting to be sent, and the transfer in progress. The view only draws it.
 * Closing the panel does not stop a transfer: its end is announced with a notification.
 *
 * Signal: 'changed'. phase: scan | pick | waiting | sending | done | error
 */
export class LocalSendSession extends Signals.EventEmitter {
    /** @param {{service: LocalSendService, notify: (title, description, icon) => void, isVisible: () => boolean}} params */
    constructor({service, notify, isVisible}) {
        super();
        this._service = service;
        this._notify = notify;
        this._isVisible = isVisible;
        this._cancellable = null;
        this._scannedAt = 0;
        this._gone = false;
        this.device = null;
        this.phase = 'pick';
        this.devices = [];
        this.sent = 0;
        this.total = 0;
        this.message = '';
        service.connectObject('basket-changed', () => this.emit('changed'), this);
    }

    get basket() {
        return this._service.basket;
    }

    get busy() {
        return !!this._cancellable;
    }

    /** Files were dropped / sent from the tray: they join the basket. */
    offer(uris) {
        this._service.addToBasket(uris);
        if (this.phase === 'done' || this.phase === 'error')
            this.phase = 'pick';
        this.emit('changed');
    }

    remove(uris) {
        this._service.removeFromBasket(uris);
    }

    /** The section was opened: look for devices unless a recent list or a transfer is there. */
    refresh({force = false} = {}) {
        if (this.busy)
            return;
        if (this.phase === 'done' || this.phase === 'error')
            this.phase = 'pick';
        if (force || Date.now() - this._scannedAt > STALE_MS)
            this.scan();
        else
            this.emit('changed');
    }

    scan() {
        if (this.busy)
            return;
        this.devices = [];
        this.phase = 'scan';
        this._scannedAt = Date.now();
        this.emit('changed');
        this._service.disconnectObject(this._scanOwner ??= {});
        this._service.connectObject('found', (_s, device) => {
            if (this.phase !== 'scan' || this.devices.some(d => d.ip === device.ip))
                return;
            this.devices.push(device);
            this.emit('changed');
        }, this._scanOwner);
        this._service.scan().then(() => {
            if (this._gone || this.phase !== 'scan')
                return;
            this.phase = 'pick';
            this.emit('changed');
        });
    }

    /** Sends the basket to a device. */
    async sendTo(device) {
        const uris = [...this._service.basket];
        if (this.busy || uris.length === 0)
            return;
        this._service.cancelScan();
        this.device = device;
        this._cancellable = new Gio.Cancellable();
        this.phase = 'waiting';
        this.total = 0;
        this.sent = 0;
        this.emit('changed');
        try {
            const result = await this._service.send(device, uris, {
                cancellable: this._cancellable,
                onState: state => {
                    this.phase = state.phase;
                    this.sent = state.sent;
                    this.total = state.total;
                    this.emit('changed');
                },
            });
            this._service.removeFromBasket(uris);
            this.phase = 'done';
            this.message = result.skipped > 0 ? `Sent (${result.skipped} folder skipped)` : `Sent to ${device.alias}`;
            if (!this._isVisible())
                this._notify(`Sent to ${device.alias}`, `${result.count} file${result.count === 1 ? '' : 's'}`, 'emblem-ok-symbolic');
        } catch (e) {
            this.phase = 'error';
            this.message = e.message;
            if (!this._isVisible() && e.message !== 'Cancelled')
                this._notify('LocalSend', e.message, 'dialog-warning-symbolic');
        }
        this._cancellable = null;
        if (!this._gone)
            this.emit('changed');
    }

    /** Stops a transfer that is on its way. */
    cancel() {
        this._cancellable?.cancel();
    }

    destroy() {
        this._gone = true;
        this._cancellable?.cancel();
        this._service.cancelScan();
        this._service.disconnectObject(this);
        if (this._scanOwner)
            this._service.disconnectObject(this._scanOwner);
    }
}
