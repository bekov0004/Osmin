import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Module} from '../module.js';

const readText = path => {
    try {
        return new TextDecoder().decode(GLib.file_get_contents(path)[1]);
    } catch (e) {
        return null;
    }
};
const listDir = path => {
    try {
        const names = [];
        const enumerator = Gio.File.new_for_path(path).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null))
            names.push(info.get_name());
        return names;
    } catch (e) {
        return [];
    }
};

const SELF = Number((readText('/proc/self/stat') ?? '0').split(' ')[0]);
const UID = Number(readText('/proc/self/status')?.match(/^Uid:\s+(\d+)/m)?.[1] ?? -1);

/**
 * The user's own processes and the ports they listen on, for the command bar ("kill firefox",
 * "ports"). Only processes of the same user are shown and can be stopped (a polite stop first:
 * SIGTERM; SIGKILL on request). Nothing else is touched.
 */
export class ProcessesModule extends Module {
    constructor() {
        super('Processes');
    }

    _processes() {
        const result = [];
        for (const name of listDir('/proc').filter(n => /^\d+$/.test(n))) {
            const pid = Number(name);
            const status = readText(`/proc/${pid}/status`);
            if (!status || Number(status.match(/^Uid:\s+(\d+)/m)?.[1]) !== UID)
                continue;
            const comm = (readText(`/proc/${pid}/comm`) ?? '').trim();
            if (!comm)
                continue;
            const cmd = (readText(`/proc/${pid}/cmdline`) ?? '').split('\0').join(' ').trim();
            const rss = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024;
            result.push({pid, name: comm, cmd, memory: rss});
        }
        return result;
    }

    /** @param {{query: string}} args -> {processes: [{pid, name, cmd, memory}]} (the biggest first) */
    async rpc_list({query = ''}) {
        const q = String(query).toLowerCase().trim();
        const own = new Set([SELF]);
        const processes = this._processes()
            .filter(p => !own.has(p.pid) && p.pid > 1 && (q === '' || p.name.toLowerCase().includes(q) || p.cmd.toLowerCase().includes(q)))
            .sort((a, b) => b.memory - a.memory)
            .slice(0, 8);
        return {processes};
    }

    /** @param {{pid: number, force?: boolean}} args */
    async rpc_stop({pid, force = false}) {
        pid = Number(pid);
        const status = readText(`/proc/${pid}/status`);
        if (!status || Number(status.match(/^Uid:\s+(\d+)/m)?.[1]) !== UID)
            throw new Error('That process is not yours (or it is gone)');
        if (pid <= 1 || pid === SELF)
            throw new Error('Not allowed');
        Gio.Subprocess.new(['kill', force ? '-KILL' : '-TERM', String(pid)], Gio.SubprocessFlags.STDERR_SILENCE);
        return {};
    }

    /** -> {ports: [{port, protocol, pid, name}]} the TCP / UDP ports that something of yours listens on */
    async rpc_ports() {
        const sockets = new Map(); // inode -> {port, protocol}
        for (const [file, protocol, listenState] of [['tcp', 'TCP', '0A'], ['tcp6', 'TCP', '0A'], ['udp', 'UDP', '07'], ['udp6', 'UDP', '07']]) {
            for (const line of (readText(`/proc/net/${file}`) ?? '').split('\n').slice(1)) {
                const fields = line.trim().split(/\s+/);
                if (fields.length < 10 || fields[3] !== listenState)
                    continue;
                const port = parseInt(fields[1].split(':')[1], 16);
                sockets.set(fields[9], {port, protocol});
            }
        }
        const found = new Map();
        for (const process of this._processes()) {
            for (const fd of listDir(`/proc/${process.pid}/fd`)) {
                let target = '';
                try {
                    target = GLib.file_read_link(`/proc/${process.pid}/fd/${fd}`);
                } catch (e) {
                    continue;
                }
                const inode = target.match(/^socket:\[(\d+)\]$/)?.[1];
                const socket = inode ? sockets.get(inode) : null;
                if (socket)
                    found.set(`${socket.protocol}:${socket.port}`, {...socket, pid: process.pid, name: process.name});
            }
        }
        return {ports: [...found.values()].sort((a, b) => a.port - b.port).slice(0, 20)};
    }
}
