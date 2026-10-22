import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const PORT = 53317;
const API = '/api/localsend/v2';
const MULTICAST = '224.0.0.167';
const ASK_TIMEOUT_S = 60;
const MAX_FILES = 500;

const decode = bytes => new TextDecoder().decode(bytes);

/** A file name that is only a name: no folders, nothing hidden or empty. */
function safeName(name) {
    const base = String(name ?? '').split(/[\\/]/).pop().replace(/[\0-\x1f]/g, '').trim();
    return base === '' || base === '.' || base === '..' ? 'file' : base.replace(/^\.+/, '_');
}

/** A path in the folder that does not exist yet: "a.pdf", "a (1).pdf", ... */
function freePath(folder, name) {
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    for (let i = 0; i < 1000; i++) {
        const path = `${folder}/${i === 0 ? name : `${stem} (${i})${ext}`}`;
        if (!GLib.file_test(path, GLib.FileTest.EXISTS))
            return path;
    }
    return `${folder}/${GLib.uuid_string_random()}${ext}`;
}

/**
 * One incoming transfer: who sends what, and what became of it. The user decides with
 * accept() / decline(); then the files arrive. Signal: 'changed'.
 * state: asking | receiving | done | failed | declined
 */
export class IncomingTransfer extends Signals.EventEmitter {
    constructor({sender, files, folder, onDecision}) {
        super();
        this.sender = sender;           // {alias, deviceModel, deviceType}
        this.files = files;             // [{id, name, size, token, path, received}]
        this.total = files.reduce((sum, f) => sum + f.size, 0);
        this.received = 0;
        this.folder = folder;
        this.state = 'asking';
        this.error = '';
        this.sessionId = GLib.uuid_string_random();
        this._onDecision = onDecision;
    }

    accept() {
        if (this.state !== 'asking')
            return;
        this.state = 'receiving';
        this._onDecision(true);
        this.emit('changed');
    }

    decline() {
        if (this.state === 'asking') {
            this.state = 'declined';
            this._onDecision(false);
        } else if (this.state === 'receiving') {
            this.fail('Cancelled');
        }
        this.emit('changed');
    }

    progress(bytes) {
        this.received += bytes;
        this.emit('changed');
    }

    finish() {
        this.state = 'done';
        this.emit('changed');
    }

    fail(message) {
        if (this.state === 'done' || this.state === 'failed' || this.state === 'declined')
            return;
        this.state = 'failed';
        this.error = message;
        this.emit('changed');
    }
}

/**
 * Receives files from LocalSend devices (protocol v2), without the LocalSend app. It listens on
 * port 53317 (HTTPS, with Osmin's own certificate) and on LocalSend's multicast address so that
 * other devices find it. A sender must be accepted by the user for every transfer; files go to
 * the Downloads folder under a free name. Off unless the user turns it on.
 *
 * Signal: 'incoming' (IncomingTransfer)
 */
export class LocalSendServer extends Signals.EventEmitter {
    /** @param {LocalSendService} service gives the identity and the certificate */
    constructor(service) {
        super();
        this._service = service;
        this._server = null;
        this._socket = null;
        this._socketSource = null;
        this._current = null;
        this._files = new Map(); // token -> {transfer, file}
    }

    get running() {
        return !!this._server;
    }

    /** @returns {Promise<string|null>} null when it runs, otherwise why it does not */
    async start() {
        if (this._server)
            return null;
        const certificate = await this._service.loadCertificate();
        if (!certificate)
            return 'No certificate (the openssl tool is needed)';
        try {
            const server = new Soup.Server({tls_certificate: certificate});
            server.add_early_handler(API, (_s, msg, path, query) => this._onHeaders(msg, path, query ?? {}));
            server.add_handler(API, (_s, msg, path, query) => this._onRequest(msg, path, query ?? {}));
            server.listen_all(PORT, Soup.ServerListenOptions.HTTPS);
            this._server = server;
        } catch (e) {
            return e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.ADDRESS_IN_USE)
                ? 'Port 53317 is busy (is the LocalSend app running?)' : e.message;
        }
        this._listenForAnnouncements();
        this._announce();
        return null;
    }

    stop() {
        this._current?.fail('Stopped');
        this._current = null;
        this._files.clear();
        if (this._socketSource) {
            this._socketSource.destroy();
            this._socketSource = null;
        }
        this._socket?.close();
        this._socket = null;
        this._server?.disconnect();
        this._server = null;
    }

    // --- discovery -------------------------------------------------------------

    get _me() {
        return {...this._service.identity, protocol: 'https', download: false};
    }

    /** Tells the network that this device is here; devices that hear it answer with their own info. */
    _announce() {
        try {
            const socket = this._socket ?? Gio.Socket.new(Gio.SocketFamily.IPV4, Gio.SocketType.DATAGRAM, Gio.SocketProtocol.UDP);
            const data = new TextEncoder().encode(JSON.stringify({...this._me, announce: true}));
            socket.send_to(Gio.InetSocketAddress.new_from_string(MULTICAST, PORT), data, null);
            if (!this._socket)
                socket.close();
        } catch (e) {
            console.warn(`[osmin] LocalSend announce failed: ${e.message}`);
        }
    }

    _listenForAnnouncements() {
        try {
            const socket = Gio.Socket.new(Gio.SocketFamily.IPV4, Gio.SocketType.DATAGRAM, Gio.SocketProtocol.UDP);
            socket.set_blocking(false);
            socket.bind(Gio.InetSocketAddress.new_from_string('0.0.0.0', PORT), true);
            socket.join_multicast_group(Gio.InetAddress.new_from_string(MULTICAST), false, null);
            const source = socket.create_source(GLib.IOCondition.IN, null);
            source.set_callback(() => {
                this._onDatagram(socket);
                return GLib.SOURCE_CONTINUE;
            });
            source.attach(null);
            this._socket = socket;
            this._socketSource = source;
        } catch (e) {
            console.warn(`[osmin] LocalSend: not listening for announcements (${e.message})`);
        }
    }

    _onDatagram(socket) {
        try {
            const [bytes, address] = socket.receive_bytes_from(4096, 0, null);
            const info = JSON.parse(decode(bytes.toArray()));
            if (!info?.announce || info.fingerprint === this._service.identity.fingerprint)
                return;
            // Answer by registering with the device that announced itself.
            const ip = address.get_address().to_string();
            this._service.register({ip, port: Number(info.port) || PORT, protocol: info.protocol === 'http' ? 'http' : 'https'}, this._me);
        } catch (e) {
            // not for us / not LocalSend
        }
    }

    // --- requests --------------------------------------------------------------

    _reply(msg, status, object = null) {
        msg.set_status(status, null);
        if (object !== null)
            msg.set_response('application/json', Soup.MemoryUse.COPY, new TextEncoder().encode(JSON.stringify(object)));
    }

    /** Right after the headers: an upload is written to disk chunk by chunk, not kept in memory. */
    _onHeaders(msg, path, query) {
        if (path !== `${API}/upload` || msg.get_method() !== 'POST')
            return;
        const found = this._files.get(query.token);
        const transfer = found?.transfer;
        if (!transfer || transfer !== this._current || transfer.state !== 'receiving' ||
            query.sessionId !== transfer.sessionId || query.fileId !== found.file.id) {
            msg.get_request_body().set_accumulate(false);
            msg._osminRejected = true;
            return;
        }
        const file = found.file;
        const body = msg.get_request_body();
        body.set_accumulate(false);
        try {
            file.stream = Gio.File.new_for_path(file.partPath).replace(null, false, Gio.FileCreateFlags.NONE, null);
        } catch (e) {
            msg._osminRejected = true;
            transfer.fail('Could not write the file');
            return;
        }
        msg.connect('got-chunk', (_m, chunk) => {
            try {
                file.stream?.write_bytes(chunk, null);
                file.received += chunk.get_size();
                transfer.progress(chunk.get_size());
            } catch (e) {
                transfer.fail('Could not write the file');
            }
        });
        msg.connect('disconnected', () => {
            if (!file.done) {
                this._discard(file);
                transfer.fail('The sender stopped');
            }
        });
    }

    _onRequest(msg, path, query) {
        const method = msg.get_method();
        const endpoint = path.slice(API.length);
        if (method === 'GET' && endpoint === '/info') {
            this._reply(msg, 200, this._me);
        } else if (method === 'POST' && endpoint === '/register') {
            // A device introduces itself: answer with ours.
            this._reply(msg, 200, this._me);
        } else if (method === 'POST' && endpoint === '/prepare-upload') {
            this._onPrepare(msg);
        } else if (method === 'POST' && endpoint === '/upload') {
            this._onUpload(msg, query);
        } else if (method === 'POST' && endpoint === '/cancel') {
            if (this._current && this._current.sessionId === query.sessionId)
                this._current.fail('The sender cancelled');
            this._reply(msg, 200);
        } else {
            this._reply(msg, 404, {message: 'Not found'});
        }
    }

    _onPrepare(msg) {
        let request;
        try {
            request = JSON.parse(decode(msg.get_request_body().flatten().get_data()));
        } catch (e) {
            this._reply(msg, 400, {message: 'Invalid body'});
            return;
        }
        const entries = Object.values(request?.files ?? {});
        if (entries.length === 0 || entries.length > MAX_FILES) {
            this._reply(msg, 400, {message: 'Invalid body'});
            return;
        }
        if (this._current && ['asking', 'receiving'].includes(this._current.state)) {
            this._reply(msg, 409, {message: 'Blocked by another session'});
            return;
        }

        const folder = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ?? GLib.get_home_dir();
        const files = entries.map((entry, index) => ({
            id: String(entry.id ?? index),
            name: safeName(entry.fileName),
            size: Math.max(0, Number(entry.size) || 0),
            token: GLib.uuid_string_random(),
            received: 0,
            done: false,
            path: null,
            partPath: null,
        }));
        const info = request.info ?? {};
        let decide = null;
        const transfer = new IncomingTransfer({
            sender: {alias: String(info.alias ?? 'Unknown device'), deviceModel: String(info.deviceModel ?? ''), deviceType: String(info.deviceType ?? 'desktop')},
            files,
            folder,
            onDecision: accepted => decide(accepted),
        });
        this._current = transfer;

        // The answer waits for the user.
        msg.pause();
        let answered = false;
        let timer = 0;
        decide = accepted => {
            if (answered)
                return;
            answered = true;
            if (timer)
                GLib.source_remove(timer);
            if (accepted) {
                GLib.mkdir_with_parents(folder, 0o755);
                const tokens = {};
                for (const file of files) {
                    file.path = freePath(folder, file.name);
                    file.partPath = `${file.path}.osmin-part`;
                    this._files.set(file.token, {transfer, file});
                    tokens[file.id] = file.token;
                }
                this._reply(msg, 200, {sessionId: transfer.sessionId, files: tokens});
            } else {
                this._reply(msg, 403, {message: 'Rejected'});
            }
            msg.unpause();
        };
        timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, ASK_TIMEOUT_S, () => {
            timer = 0;
            transfer.decline();
            return GLib.SOURCE_REMOVE;
        });
        msg.connect('disconnected', () => {
            if (!answered) {
                answered = true;
                if (timer)
                    GLib.source_remove(timer);
                transfer.fail('The sender stopped');
            }
        });
        this.emit('incoming', transfer);
    }

    _onUpload(msg, query) {
        if (msg._osminRejected) {
            this._reply(msg, 403, {message: 'Invalid token'});
            return;
        }
        const found = this._files.get(query.token);
        const transfer = found?.transfer;
        if (!transfer) {
            this._reply(msg, 403, {message: 'Invalid token'});
            return;
        }
        const file = found.file;
        try {
            file.stream?.close(null);
            file.stream = null;
            Gio.File.new_for_path(file.partPath).move(Gio.File.new_for_path(file.path), Gio.FileCopyFlags.NONE, null, null);
        } catch (e) {
            this._discard(file);
            transfer.fail('Could not save the file');
            this._reply(msg, 500, {message: 'Could not save'});
            return;
        }
        file.done = true;
        this._files.delete(file.token);
        this._reply(msg, 200);
        if (transfer.files.every(f => f.done))
            transfer.finish();
    }

    _discard(file) {
        try {
            file.stream?.close(null);
            file.stream = null;
            if (file.partPath)
                Gio.File.new_for_path(file.partPath).delete(null);
        } catch (e) {
            // nothing was written yet
        }
    }

    destroy() {
        this.stop();
    }
}
