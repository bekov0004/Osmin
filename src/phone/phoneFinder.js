import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {fingerprint, hmac, randomToken, run} from './phoneLink.js';

/**
 * The computer looks for the phone too (the other half of phoneLink.js, where the phone looks for the computer). The Osmin
 * Phone app's server listens on the phone on PHONE_PORT, and a phone that is asleep still answers on the network, so the
 * computer can reach it to wake it, unlock it or show it without the phone having to find the computer first.
 * The greeting is the same with the roles swapped (see Link.kt): the computer says HELLO2, the phone proves it knows the
 * secret (CHAL), the computer proves it too (AUTH), the phone says "OK <screen> <sdk> <model>".
 */
export const PHONE_PORT = 47832;
const CONNECT_MS = 500;
const GREETING_MS = 5000;
const MAX_PARALLEL = 48;
const MAX_PREFIX_SIZE = 22;      // at most 1022 addresses of one network

const toNumber = ip => ((ip[0] * 256 + ip[1]) * 256 + ip[2]) * 256 + ip[3];
const dotted = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].join('.');

export function isPrivate(address) {
    const p = address.split('.').map(Number);
    return p.length === 4 && (p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168));
}

/** The addresses `ip neigh` lists that answered lately (machines this computer talked to). */
export function neighboursOf(text) {
    return text.split('\n').map(line => line.trim().split(/\s+/)).filter(p => p.length > 3 && /^\d+\.\d+\.\d+\.\d+$/.test(p[0]) && !['FAILED', 'INCOMPLETE'].includes(p[p.length - 1])).map(p => p[0]);
}

/** The networks of this computer where a phone can be: private ones, not the bridges of containers and virtual machines. */
export function realNetworks(localText) {
    const nets = [];
    for (const line of localText.split('\n')) {
        const match = /inet (\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+).*?(\S+)\s*$/.exec(line);
        if (!match)
            continue;
        const ip = match.slice(1, 5).map(Number);
        if (isPrivate(ip.join('.')) && !/^(docker|br-|virbr|veth|lxc|lxd|podman|cni|flannel)/.test(match[6]))
            nets.push({ip, prefix: Number(match[5])});
    }
    return nets;
}

/**
 * Where the phone may be, most likely first: where it was found last, the machines this computer already talked to, the
 * first addresses of each network, then the rest of the networks (a big one only around this computer). Private
 * networks only, and not the bridges of containers.
 */
export function candidates(localText, neighbourText, last) {
    const result = new Set();
    if (last)
        result.add(last);
    const nets = realNetworks(localText);
    const ranges = nets.map(net => {
        const prefix = net.prefix < MAX_PREFIX_SIZE ? 24 : net.prefix;
        const size = 2 ** (32 - prefix);
        const start = Math.floor(toNumber(net.ip) / size) * size;
        return [start, start + size];
    });
    const inRanges = address => ranges.some(([from, to]) => toNumber(address.split('.').map(Number)) >= from && toNumber(address.split('.').map(Number)) < to);
    for (const address of neighboursOf(neighbourText)) {
        if (isPrivate(address) && inRanges(address))
            result.add(address);
    }
    for (const [from] of ranges)
        result.add(dotted(from + 1));
    for (const [from, to] of ranges) {
        for (let n = from + 1; n < to - 1; n++)
            result.add(dotted(n));
    }
    return [...result];
}

/** Opens a connection (a promise), or null when nothing answers within [timeoutMs]. */
function connect(host, port, timeoutMs) {
    return new Promise(resolve => {
        const cancellable = new Gio.Cancellable();
        let timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
            timer = 0;
            cancellable.cancel();
            return GLib.SOURCE_REMOVE;
        });
        new Gio.SocketClient().connect_to_host_async(`${host}:${port}`, port, cancellable, (client, result) => {
            if (timer)
                GLib.source_remove(timer);
            try {
                const connection = client.connect_to_host_finish(result);
                connection.get_socket().set_keepalive(true);
                resolve(connection);
            } catch (e) {
                resolve(null);
            }
        });
    });
}

/** One line from the raw stream, byte by byte: nothing after the newline is taken (the picture may follow at once). */
function readLine(connection, timeoutMs) {
    return new Promise(resolve => {
        const input = connection.get_input_stream();
        const cancellable = new Gio.Cancellable();
        const bytes = [];
        let done = false;
        const finish = value => {
            if (done)
                return;
            done = true;
            if (timer)
                GLib.source_remove(timer);
            resolve(value);
        };
        let timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
            timer = 0;
            cancellable.cancel();
            finish(null);
            return GLib.SOURCE_REMOVE;
        });
        const next = () => input.read_bytes_async(1, GLib.PRIORITY_DEFAULT, cancellable, (_s, result) => {
            let chunk;
            try {
                chunk = input.read_bytes_finish(result).toArray();
            } catch (e) {
                finish(null);
                return;
            }
            if (chunk.length === 0 || bytes.length > 4096) {
                finish(null);
                return;
            }
            if (chunk[0] === 10)
                finish(new TextDecoder().decode(Uint8Array.from(bytes)).trim());
            else {
                bytes.push(chunk[0]);
                next();
            }
        });
        next();
    });
}

function write(connection, text) {
    try {
        connection.get_output_stream().write_all(`${text}\n`, null);
        connection.get_output_stream().flush(null);
        return true;
    } catch (e) {
        return false;
    }
}

/** One connection to the phone with the greeting done. @returns {Promise<{connection, info: string}|null>} */
async function greet(host, port, token, role) {
    const connection = await connect(host, port, CONNECT_MS * 4);
    if (!connection)
        return null;
    const fail = () => {
        try {
            connection.close(null);
        } catch (e) {
            // gone
        }
        return null;
    };
    const mine = randomToken();
    if (!write(connection, `HELLO2 ${role} ${fingerprint(token)} ${mine}`))
        return fail();
    const challenge = (await readLine(connection, GREETING_MS))?.split(' ');
    // the phone must know the secret too: a machine that merely answers on the port learns nothing
    if (!challenge || challenge.length !== 3 || challenge[0] !== 'CHAL' || challenge[2] !== hmac(token, `srv|${mine}|${challenge[1]}`))
        return fail();
    if (!write(connection, `AUTH ${hmac(token, `cli|${challenge[1]}|${mine}`)} -`))
        return fail();
    const answer = await readLine(connection, GREETING_MS);
    if (!answer?.startsWith('OK'))
        return fail();
    return {connection, info: answer.slice(2).trim()};
}

/** Dials the phone at [host] twice (C and V). @returns {Promise<{control, video, info}|null>} */
export async function dial(host, token, port = PHONE_PORT) {
    const control = await greet(host, port, token, 'C');
    if (!control)
        return null;
    const video = await greet(host, port, token, 'V');
    if (!video) {
        control.connection.close(null);
        return null;
    }
    return {control: control.connection, video: video.connection, info: control.info};
}

/** Whether the phone's server answers at [host] (only the port: nothing is said). */
export async function reachable(host, port = PHONE_PORT, timeoutMs = 800) {
    const connection = await connect(host, port, timeoutMs);
    connection?.close(null);
    return !!connection;
}

/** Which of the [hosts] have [port] open (a few at a time), in the order given. */
export async function openHosts(hosts, port = PHONE_PORT, timeoutMs = CONNECT_MS) {
    const open = new Set();
    let next = 0;
    const worker = async () => {
        while (next < hosts.length) {
            const host = hosts[next++];
            const connection = await connect(host, port, timeoutMs);
            if (connection) {
                open.add(host);
                connection.close(null);
            }
        }
    };
    await Promise.all(Array.from({length: Math.min(MAX_PARALLEL, hosts.length)}, worker));
    return hosts.filter(host => open.has(host));
}

/**
 * Looks for the phone: where it was last, then the networks of this computer. @returns {Promise<{host, control, video, info}|null>}
 */
export async function seekPhone({token, last = '', port = PHONE_PORT}) {
    // Where it was last: at once, before the networks are searched (that takes a few seconds).
    if (last) {
        const found = await dial(last, token, port);
        if (found)
            return {host: last, ...found};
    }
    const local = await run(['ip', '-4', 'addr', 'show']);
    const neighbours = await run(['ip', 'neigh']);
    const hosts = candidates(local.out, neighbours.out, null).filter(host => host !== last);
    for (const host of await openHosts(hosts, port)) {
        const found = await dial(host, token, port);
        if (found)
            return {host, ...found};
    }
    return null;
}
