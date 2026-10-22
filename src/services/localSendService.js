import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

const PORT = 53317;
const API = '/api/localsend/v2';
const PROTOCOL_VERSION = '2.0';
const PROBE_TIMEOUT_S = 2;
// Network interfaces that are never a place where phones live.
const VIRTUAL_INTERFACE = /^(lo|docker|br-|veth|virbr|tun|tap|vmnet|zt)/;

const CERT_DIR = `${GLib.get_user_data_dir()}/osmin`;

const decode = bytes => new TextDecoder().decode(bytes.get_data());

/**
 * Sends files to devices running LocalSend (protocol v2), without the LocalSend
 * app. It only sends: it does not listen on the network. Devices are found by
 * asking every address of the local subnet for LocalSend's /info (nothing is
 * registered or announced), and a transfer is "prepare-upload" (the receiver
 * asks its user to accept) followed by one upload per file.
 *
 * It also keeps the "basket": the files that are waiting to be sent (added by dropping
 * them on the LocalSend target or from the tray), so several can be collected first.
 *
 * Signals: 'basket-changed'; 'found' (device) while scanning. A device is
 * {ip, port, protocol, alias, deviceModel, deviceType}.
 */
export class LocalSendService extends Signals.EventEmitter {
    constructor() {
        super();
        this._cancellable = new Gio.Cancellable();
        this._fingerprint = Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
        this._scanning = null;
        this._basket = [];
        this._certificate = undefined; // undefined: not loaded yet; null: could not be made
    }

    /**
     * Newer LocalSend versions ask the sender for a TLS certificate, so Osmin has its own
     * (made once with the openssl tool, kept in ~/.local/share/osmin, and used for nothing else).
     */
    async loadCertificate() {
        if (this._certificate !== undefined)
            return this._certificate;
        const certPath = `${CERT_DIR}/localsend-cert.pem`;
        const keyPath = `${CERT_DIR}/localsend-key.pem`;
        try {
            if (!GLib.file_test(certPath, GLib.FileTest.EXISTS) || !GLib.file_test(keyPath, GLib.FileTest.EXISTS)) {
                GLib.mkdir_with_parents(CERT_DIR, 0o700);
                const process = Gio.Subprocess.new(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                    '-keyout', keyPath, '-out', certPath, '-days', '36500', '-subj', '/CN=Osmin'],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
                await process.wait_check_async(null);
                GLib.chmod(keyPath, 0o600);
            }
            this._certificate = Gio.TlsCertificate.new_from_files(certPath, keyPath);
            const der = this._certificate.certificate?.toArray?.() ?? this._certificate.certificate;
            this._fingerprint = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, der);
        } catch (e) {
            console.warn(`[osmin] LocalSend: no client certificate (${e.message}); some devices will not answer`); this._lastCertError = e.message;
            this._certificate = null;
        }
        return this._certificate;
    }

    /** Lets a message answer a device's request for a client certificate. */
    _presentCertificate(message) {
        message.connect('accept-certificate', () => true);
        message.connect('request-certificate', () => {
            if (!this._certificate)
                return false;
            message.set_tls_client_certificate(this._certificate);
            return true;
        });
    }

    /** file:// URIs waiting to be sent */
    get basket() {
        return this._basket;
    }

    addToBasket(uris) {
        const added = uris.filter(uri => !this._basket.includes(uri));
        if (added.length === 0)
            return;
        this._basket.push(...added);
        this.emit('basket-changed');
    }

    removeFromBasket(uris) {
        const before = this._basket.length;
        this._basket = this._basket.filter(uri => !uris.includes(uri));
        if (this._basket.length !== before)
            this.emit('basket-changed');
    }

    /** Who this device is, as other devices see it. */
    get identity() {
        return {
            alias: GLib.get_host_name(),
            version: PROTOCOL_VERSION,
            deviceModel: 'Linux',
            deviceType: 'desktop',
            fingerprint: this._fingerprint,
            port: PORT,
        };
    }

    get _me() {
        return {...this.identity, protocol: 'http', download: false};
    }

    /** Introduces this device to another one (POST /register); the answer is not needed. */
    async register(device, info) {
        try {
            const session = new Soup.Session({timeout: PROBE_TIMEOUT_S});
            const message = Soup.Message.new('POST', `${device.protocol}://${device.ip}:${device.port}${API}/register`);
            this._presentCertificate(message);
            message.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(JSON.stringify(info))));
            await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            session.abort();
        } catch (e) {
            // the device went away
        }
    }

    /**
     * Looks for devices on the local network; emits 'found' for each.
     * @param {{hosts?: string[]}} [options] hosts: addresses to ask instead of the local subnets
     * @returns {Promise<void>} resolves when the whole subnet was asked (or the scan was cancelled)
     */
    async scan({hosts = null} = {}) {
        this.cancelScan();
        const cancellable = new Gio.Cancellable();
        this._scanning = cancellable;
        await this.loadCertificate();
        if (cancellable.is_cancelled())
            return;
        const session = new Soup.Session({timeout: PROBE_TIMEOUT_S, idle_timeout: PROBE_TIMEOUT_S, max_conns: 128, max_conns_per_host: 2});
        try {
            const addresses = hosts ?? await this._subnetAddresses(cancellable);
            let next = 0;
            const worker = async () => {
                while (next < addresses.length && !cancellable.is_cancelled()) {
                    const device = await this._probe(session, addresses[next++], PORT, cancellable);
                    if (device && !cancellable.is_cancelled())
                        this.emit('found', device);
                }
            };
            await Promise.all(Array.from({length: Math.min(64, addresses.length)}, worker));
        } catch (e) {
            if (!cancellable.is_cancelled())
                console.warn(`[osmin] LocalSend scan failed: ${e.message}`);
        } finally {
            session.abort();
            if (this._scanning === cancellable)
                this._scanning = null;
        }
    }

    cancelScan() {
        this._scanning?.cancel();
        this._scanning = null;
    }

    /** Addresses of the /24 around each of this machine's LAN addresses, except its own. */
    async _subnetAddresses(cancellable) {
        const process = Gio.Subprocess.new(['ip', '-4', '-o', 'addr', 'show', 'scope', 'global'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        const [out] = await process.communicate_utf8_async(null, cancellable);
        const result = [];
        for (const line of (out ?? '').split('\n')) {
            const match = line.match(/^\d+:\s+(\S+)\s+inet\s+(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)/);
            if (!match || VIRTUAL_INTERFACE.test(match[1]))
                continue;
            const [a, b, c, d] = match.slice(2, 6).map(Number);
            for (let host = 1; host < 255; host++) {
                if (host !== d)
                    result.push(`${a}.${b}.${c}.${host}`);
            }
        }
        return result;
    }

    /** @returns {Promise<object|null>} the device at that address, if it runs LocalSend */
    async _probe(session, ip, port, cancellable) {
        for (const protocol of ['https', 'http']) {
            try {
                const message = Soup.Message.new('GET', `${protocol}://${ip}:${port}${API}/info`);
                this._presentCertificate(message);
                const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
                if (message.status_code !== 200)
                    return null;
                const info = JSON.parse(decode(bytes));
                if (typeof info?.alias !== 'string')
                    return null;
                return {
                    ip, port, protocol,
                    alias: info.alias,
                    deviceModel: info.deviceModel ?? '',
                    deviceType: info.deviceType ?? 'desktop',
                };
            } catch (e) {
                // Nobody there: no need to try the other protocol. A refusal to talk TLS (or plain HTTP) is.
                if (cancellable.is_cancelled() ||
                    e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CONNECTION_REFUSED) ||
                    e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.TIMED_OUT) ||
                    e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.HOST_UNREACHABLE) ||
                    e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NETWORK_UNREACHABLE) ||
                    e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return null;
            }
        }
        return null;
    }

    /**
     * Sends files to a device. `onState({phase, sent, total, skipped})`: 'waiting' (until the
     * receiver accepts), 'sending'. Rejects with a short, readable Error.
     * @param {object} device
     * @param {string[]} uris file:// URIs (folders are skipped)
     * @param {{onState?: Function, cancellable?: Gio.Cancellable}} [options]
     * @returns {Promise<{count: number, skipped: number}>}
     */
    async send(device, uris, {onState = () => {}, cancellable = new Gio.Cancellable()} = {}) {
        const files = {};
        const entries = [];
        let skipped = 0;
        for (const uri of uris) {
            const file = Gio.File.new_for_uri(uri);
            let info;
            try {
                info = file.query_info('standard::type,standard::size,standard::content-type', Gio.FileQueryInfoFlags.NONE, null);
            } catch (e) {
                skipped++;
                continue;
            }
            if (info.get_file_type() !== Gio.FileType.REGULAR) {
                skipped++;
                continue;
            }
            const id = `file${entries.length}`;
            const entry = {id, file, size: info.get_size(), type: info.get_content_type() ?? 'application/octet-stream'};
            entries.push(entry);
            files[id] = {id, fileName: file.get_basename(), size: entry.size, fileType: entry.type};
        }
        if (entries.length === 0)
            throw new Error('Nothing to send (folders are not supported yet)');
        const total = entries.reduce((sum, e) => sum + e.size, 0);

        await this.loadCertificate();
        const session = new Soup.Session({timeout: 0, idle_timeout: 0});
        const base = `${device.protocol}://${device.ip}:${device.port}${API}`;
        const request = async (path, jsonBody, contentType = 'application/json', stream = null, size = 0, onWrote = null) => {
            const message = Soup.Message.new('POST', `${base}${path}`);
            this._presentCertificate(message);
            if (stream) {
                message.set_request_body(contentType, stream, size);
                message.connect('wrote-body-data', (_m, chunk) => onWrote?.(chunk));
            } else {
                message.set_request_body_from_bytes(contentType, new GLib.Bytes(new TextEncoder().encode(jsonBody)));
            }
            const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
            return {status: message.status_code, text: decode(bytes)};
        };

        let sessionId = null;
        try {
            onState({phase: 'waiting', sent: 0, total, skipped});
            const prepared = await request('/prepare-upload', JSON.stringify({info: this._me, files}));
            if (prepared.status === 403)
                throw new Error(`${device.alias} declined`);
            if (prepared.status === 409 || prepared.status === 429)
                throw new Error(`${device.alias} is busy`);
            if (prepared.status === 204)
                return {count: 0, skipped};
            if (prepared.status !== 200)
                throw new Error(`${device.alias} answered ${prepared.status}`);
            const {sessionId: id, files: tokens} = JSON.parse(prepared.text);
            sessionId = id;

            let sent = 0;
            onState({phase: 'sending', sent, total, skipped});
            for (const entry of entries) {
                const token = tokens?.[entry.id];
                if (!token)
                    continue;
                const query = `?sessionId=${encodeURIComponent(sessionId)}&fileId=${encodeURIComponent(entry.id)}&token=${encodeURIComponent(token)}`;
                const stream = entry.file.read(null);
                try {
                    const result = await request(`/upload${query}`, null, entry.type, stream, entry.size, chunk => {
                        sent += chunk;
                        onState({phase: 'sending', sent: Math.min(sent, total), total, skipped});
                    });
                    if (result.status !== 200)
                        throw new Error(`${device.alias} stopped the transfer`);
                } finally {
                    stream.close(null);
                }
            }
            return {count: entries.length, skipped};
        } catch (e) {
            if (sessionId && !(e.message ?? '').includes('declined')) {
                const cancel = Soup.Message.new('POST', `${base}/cancel?sessionId=${encodeURIComponent(sessionId)}`);
                this._presentCertificate(cancel);
                session.send_and_read_async(cancel, GLib.PRIORITY_DEFAULT, null).catch(() => {});
            }
            if (cancellable.is_cancelled())
                throw new Error('Cancelled');
            if (e instanceof GLib.Error)
                throw new Error(`Could not reach ${device.alias}`);
            throw e;
        } finally {
            // The cancel above is fire-and-forget: leave the session to finish it.
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
                session.abort();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    destroy() {
        this.cancelScan();
        this._cancellable.cancel();
    }
}
