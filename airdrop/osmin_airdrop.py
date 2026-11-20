#!/usr/bin/env python3
"""
AirDrop for Osmin: receiving files from an iPhone over AWDL (osmin-awdld makes the radio link and the awdl0 interface).

    sudo python3 airdrop/osmin_airdrop.py receive [--dir DIR] [--name NAME] [--take-card [--channel 149]] [--ask] [--verbose]

By default the Wi-Fi card stays on its network and AWDL shares its channel: an iPhone on the same network spends many
of its AWDL slots on that channel. --take-card instead leaves the network while AirDrop runs (AWDL on --channel, no
router needed) and joins it again afterwards.

It starts osmin-awdld, then on awdl0:
  - announces the AirDrop service over mDNS (_airdrop._tcp, TXT flags) and answers the queries for it;
  - serves AirDrop over HTTPS (TLS, self-signed): /Discover (so the iPhone lists this computer), /Ask (accepted at once,
    or asked in the terminal with --ask), /Upload (a gzip'd cpio archive, unpacked into DIR, owned by the user).
The format follows the published reverse-engineering work (OpenDrop, the Owly specification). Only the standard library.
"""

import argparse
import datetime
import gzip
import io
import json
import os
import plistlib
import pwd
import random
import select
import shutil
import signal
import socket
import ssl
import struct
import subprocess
import sys
import threading
import time
import uuid
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
AIRDROP_PORT = 8771
MDNS_PORT = 5353
MDNS_GROUP = "ff02::fb"
SERVICE = "_airdrop._tcp.local."
# TXT flags: 0x001 links, 0x008 mixed types, 0x080 /Discover  (no 0x002: senders then use gzip, not DVZip)
FLAGS = 0x001 | 0x008 | 0x080
MODEL = "Osmin"


def log(*parts):
    stamp = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(stamp, "airdrop:", *parts, flush=True)


# --- the user the files belong to (we run with sudo) ------------------------------------------------------------

def owner():
    name = os.environ.get("SUDO_USER")
    try:
        return pwd.getpwnam(name) if name else pwd.getpwuid(os.getuid())
    except KeyError:
        return pwd.getpwuid(os.getuid())


def give(path, user):
    try:
        os.chown(path, user.pw_uid, user.pw_gid)
    except OSError:
        pass


# --- mDNS ----------------------------------------------------------------------------------------------------------

def dns_name(name):
    out = b""
    for label in name.rstrip(".").split("."):
        raw = label.encode()
        out += bytes([len(raw)]) + raw
    return out + b"\0"


def read_name(data, at, depth=0):
    labels = []
    while at < len(data) and depth < 20:
        n = data[at]
        if n == 0:
            return ".".join(labels) + ".", at + 1
        if n >= 0xC0:
            pointer = ((n & 0x3F) << 8) | data[at + 1]
            rest, _ = read_name(data, pointer, depth + 1)
            return ".".join(labels + [rest.rstrip(".")]) + ".", at + 2
        labels.append(data[at + 1:at + 1 + n].decode(errors="replace"))
        at += 1 + n
    return ".".join(labels) + ".", at


def record(name, rtype, rdata, ttl, flush=False):
    rclass = 0x0001 | (0x8000 if flush else 0)
    return dns_name(name) + struct.pack(">HHIH", rtype, rclass, ttl, len(rdata)) + rdata


class Mdns:
    """Our AirDrop service on awdl0: told unasked in bursts (the iPhone's questions may not reach us), and answered."""

    def __init__(self, interface, address, instance, host, port):
        self.index = socket.if_nametoindex(interface)
        self.address = address
        self.instance = f"{instance}.{SERVICE}"
        self.host = f"{host}.local."
        self.port = port
        self.sock = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):
            self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        self.sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_MULTICAST_IF, self.index)
        self.sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_MULTICAST_HOPS, 255)
        self.sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_MULTICAST_LOOP, 0)
        self.sock.bind(("::", MDNS_PORT, 0, self.index))
        group = socket.inet_pton(socket.AF_INET6, MDNS_GROUP) + struct.pack("@I", self.index)
        self.sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_JOIN_GROUP, group)
        self.stopped = False
        self.queries = 0

    def answer(self):
        txt = f"flags={FLAGS}".encode()
        records = [
            record(SERVICE, 12, dns_name(self.instance), 4500),
            record(self.instance, 33, struct.pack(">HHH", 0, 0, self.port) + dns_name(self.host), 120, True),
            record(self.instance, 16, bytes([len(txt)]) + txt, 4500, True),
            record(self.host, 28, socket.inet_pton(socket.AF_INET6, self.address), 120, True),
        ]
        return struct.pack(">HHHHHH", 0, 0x8400, 0, len(records), 0, 0) + b"".join(records)

    def announce(self):
        try:
            self.sock.sendto(self.answer(), (MDNS_GROUP, MDNS_PORT, 0, self.index))
        except OSError as error:
            log("mDNS send:", error)

    def wanted(self, packet):
        """Whether a query asks about us."""
        try:
            _, flags, questions = struct.unpack(">HHH", packet[:6])
            if flags & 0x8000:
                return False
            at = 12
            ours = {SERVICE.lower(), self.instance.lower(), self.host.lower()}
            for _ in range(questions):
                name, at = read_name(packet, at)
                at += 4
                if name.lower() in ours:
                    return True
        except (struct.error, IndexError):
            pass
        return False

    def run(self):
        last = 0.0
        while not self.stopped:
            # a burst of three every second, as long as we are visible
            now = time.monotonic()
            if now - last >= 1.0:
                for _ in range(3):
                    self.announce()
                last = now
            ready, _, _ = select.select([self.sock], [], [], 0.2)
            if not ready:
                continue
            try:
                packet, sender = self.sock.recvfrom(9000)
            except OSError:
                continue
            if sender[0].split("%")[0] == self.address:
                continue
            if self.wanted(packet):
                self.queries += 1
                log(f"mDNS question from {sender[0]}: answering")
                self.announce()
                try:
                    self.sock.sendto(self.answer(), sender)
                except OSError:
                    pass


# --- HTTP over TLS ------------------------------------------------------------------------------------------------

class Connection:
    """HTTP/1.1 on one TLS connection: requests with Content-Length or chunked bodies, one after another."""

    def __init__(self, stream):
        self.stream = stream
        self.buffer = b""

    def _fill(self):
        data = self.stream.recv(65536)
        if not data:
            raise EOFError
        self.buffer += data

    def line(self):
        while b"\r\n" not in self.buffer:
            if len(self.buffer) > 65536:
                raise ValueError("header line too long")
            self._fill()
        line, self.buffer = self.buffer.split(b"\r\n", 1)
        return line.decode("latin-1")

    def exactly(self, n):
        while len(self.buffer) < n:
            self._fill()
        data, self.buffer = self.buffer[:n], self.buffer[n:]
        return data

    def request(self):
        first = self.line()
        while first == "":
            first = self.line()
        method, path, _ = first.split(" ", 2)
        headers = {}
        while True:
            line = self.line()
            if not line:
                break
            key, _, value = line.partition(":")
            headers[key.strip().lower()] = value.strip()
        return method, path, headers

    def body_chunks(self, headers):
        """The body as it arrives (chunked or Content-Length)."""
        if headers.get("transfer-encoding", "").lower() == "chunked":
            while True:
                size = int(self.line().split(";")[0], 16)
                if size == 0:
                    while self.line():
                        pass
                    return
                remaining = size
                while remaining:
                    if not self.buffer:
                        self._fill()
                    piece = self.buffer[:remaining]
                    self.buffer = self.buffer[len(piece):]
                    remaining -= len(piece)
                    yield piece
                self.exactly(2)
        else:
            remaining = int(headers.get("content-length", "0") or 0)
            while remaining:
                if not self.buffer:
                    self._fill()
                piece = self.buffer[:remaining]
                self.buffer = self.buffer[len(piece):]
                remaining -= len(piece)
                yield piece

    def body(self, headers, limit=8 << 20):
        data = b""
        for piece in self.body_chunks(headers):
            data += piece
            if len(data) > limit:
                raise ValueError("body too large")
        return data

    def reply(self, status, reason, body=b"", headers=None, close=False):
        lines = [f"HTTP/1.1 {status} {reason}", f"Content-Length: {len(body)}",
                 f"Connection: {'close' if close else 'keep-alive'}"]
        for key, value in (headers or {}).items():
            lines.append(f"{key}: {value}")
        self.stream.sendall(("\r\n".join(lines) + "\r\n\r\n").encode() + body)


def plist(data):
    return plistlib.dumps(data, fmt=plistlib.FMT_BINARY)


# --- cpio (odc) -----------------------------------------------------------------------------------------------------

class CpioReader:
    """Unpacks an odc cpio stream as it arrives, into `folder`. Only plain files and folders, no paths outside."""

    def __init__(self, folder, user):
        self.folder = folder
        self.user = user
        self.buffer = b""
        self.state = "header"
        self.need = 76
        self.name = None
        self.left = 0
        self.file = None
        self.done = False
        self.saved = []

    def _target(self, name):
        parts = [p for p in name.replace("\\", "/").split("/") if p not in ("", ".")]
        if not parts or any(p == ".." for p in parts) or parts[-1].startswith("._"):
            return None
        return os.path.join(self.folder, *parts)

    def _free(self, path):
        base, ext = os.path.splitext(path)
        n = 1
        while os.path.exists(path):
            path = f"{base} ({n}){ext}"
            n += 1
        return path

    def feed(self, data):
        self.buffer += data
        while not self.done:
            if self.state == "header":
                if len(self.buffer) < 76:
                    return
                header, self.buffer = self.buffer[:76], self.buffer[76:]
                if header[:6] != b"070707":
                    raise ValueError("not an odc cpio archive")
                self.mode = int(header[18:24], 8)
                self.namesize = int(header[59:65], 8)
                self.left = int(header[65:76], 8)
                self.state = "name"
            elif self.state == "name":
                if len(self.buffer) < self.namesize:
                    return
                raw, self.buffer = self.buffer[:self.namesize], self.buffer[self.namesize:]
                self.name = raw.rstrip(b"\0").decode("utf-8", "replace")
                if self.name == "TRAILER!!!":
                    self.done = True
                    return
                target = self._target(self.name)
                kind = self.mode & 0o170000
                self.file = None
                if target and kind == 0o040000:
                    os.makedirs(target, exist_ok=True)
                    give(target, self.user)
                elif target and kind == 0o100000:
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    path = self._free(target)
                    self.file = open(path, "wb")
                    self.saved.append(path)
                self.state = "data"
            elif self.state == "data":
                if self.left == 0:
                    if self.file:
                        self.file.close()
                        give(self.file.name, self.user)
                        self.file = None
                    self.state = "header"
                    continue
                if not self.buffer:
                    return
                piece = self.buffer[:self.left]
                self.buffer = self.buffer[len(piece):]
                self.left -= len(piece)
                if self.file:
                    self.file.write(piece)


def cpio_member(name, data, mode=0o100644):
    raw = name.encode() + b"\0"
    header = "070707" + "%06o" % 0 + "%06o" % 0 + "%06o" % mode + "%06o" % 0 + "%06o" % 0 + "%06o" % 1 + \
        "%06o" % 0 + "%011o" % int(time.time()) + "%06o" % len(raw) + "%011o" % len(data)
    return header.encode() + raw + data


def cpio_archive(files):
    """[(name, bytes)] as an odc cpio archive: ".", the files as "./name", the trailer."""
    out = cpio_member(".", b"", 0o040755)
    for name, data in files:
        out += cpio_member("./" + name, data)
    return out + cpio_member("TRAILER!!!", b"", 0)


class DvzipReader:
    """DVZip: 4-byte big-endian lengths, then a zlib stream (or raw bytes when the top bit is set)."""

    def __init__(self, sink):
        self.sink = sink
        self.buffer = b""

    def feed(self, data):
        self.buffer += data
        while len(self.buffer) >= 4:
            n = struct.unpack(">I", self.buffer[:4])[0]
            raw = bool(n & 0x80000000)
            n &= 0x7FFFFFFF
            if n == 0 or n > 64 << 20:
                raise ValueError("bad DVZip chunk")
            if len(self.buffer) < 4 + n:
                return
            chunk, self.buffer = self.buffer[4:4 + n], self.buffer[4 + n:]
            self.sink(chunk if raw else zlib.decompress(chunk))


# --- the AirDrop server ----------------------------------------------------------------------------------------------

class Receiver:
    def __init__(self, name, folder, user, certificate, key, ask=False, on_event=None):
        self.name = name
        self.folder = folder
        self.user = user
        self.ask = ask
        self.on_event = on_event or (lambda *a: None)
        self.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.context.minimum_version = ssl.TLSVersion.TLSv1_2
        self.context.load_cert_chain(certificate, key)
        self.context.verify_mode = ssl.CERT_NONE
        self.stopped = False

    def serve(self, address, port, scope=0):
        listener = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((address, port, 0, scope))
        listener.listen(8)
        listener.settimeout(0.5)
        self.listener = listener
        while not self.stopped:
            try:
                client, peer = listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            threading.Thread(target=self._client, args=(client, peer), daemon=True).start()

    def _client(self, client, peer):
        who = peer[0]
        try:
            client.settimeout(60)
            stream = self.context.wrap_socket(client, server_side=True)
            connection = Connection(stream)
            asked = None
            while True:
                try:
                    method, path, headers = connection.request()
                except EOFError:
                    return
                log(f"{who}: {method} {path}")
                if method in ("GET", "HEAD"):
                    connection.reply(200, "OK", b"\n")
                elif method != "POST":
                    connection.reply(405, "Method Not Allowed", close=True)
                    return
                elif path == "/Discover":
                    connection.body(headers)
                    self.on_event("discover", who)
                    connection.reply(200, "OK", plist({
                        "ReceiverComputerName": self.name,
                        "ReceiverModelName": MODEL,
                        "ReceiverMediaCapabilities": json.dumps({"Version": 1}).encode(),
                        "StatusCode": 100,
                    }), {"Content-Type": "application/octet-stream"})
                elif path == "/Ask":
                    request = plistlib.loads(connection.body(headers))
                    asked = request
                    if not self._decide(who, request):
                        connection.reply(403, "Forbidden", close=True)
                        return
                    connection.reply(200, "OK", plist({"ReceiverComputerName": self.name, "ReceiverModelName": MODEL}),
                                     {"Content-Type": "application/octet-stream"})
                    for link in request.get("Items", []) or []:
                        self._link(str(link))
                elif path == "/Upload":
                    if asked is None:
                        connection.reply(403, "Forbidden", close=True)
                        return
                    self._upload(connection, headers, who)
                    return
                else:
                    connection.body(headers)
                    connection.reply(400, "Bad Request")
        except (ssl.SSLError, OSError, ValueError, plistlib.InvalidFileException, EOFError) as error:
            log(f"{who}: {type(error).__name__}: {error}")
        finally:
            try:
                client.close()
            except OSError:
                pass

    def _decide(self, who, request):
        sender = request.get("SenderComputerName", "someone")
        files = request.get("Files", []) or []
        names = ", ".join(f.get("FileName", "?") for f in files) or ", ".join(map(str, request.get("Items", []) or []))
        log(f"{sender} ({request.get('SenderModelName', '?')}) wants to send: {names}")
        self.on_event("ask", sender, names)
        if not self.ask:
            return True
        try:
            answer = input(f"Accept from {sender}? [y/N] ").strip().lower()
        except EOFError:
            answer = ""
        return answer in ("y", "yes", "д", "да")

    def _link(self, link):
        log("link:", link)
        with open(os.path.join(self.folder, "AirDrop links.txt"), "a") as f:
            f.write(link + "\n")
        give(os.path.join(self.folder, "AirDrop links.txt"), self.user)

    def _upload(self, connection, headers, who):
        kind = headers.get("content-type", "").lower()
        if kind not in ("application/x-cpio", "application/x-dvzip"):
            connection.reply(406, "Not Acceptable", close=True)
            return
        if headers.get("expect", "").lower() == "100-continue":
            connection.stream.sendall(b"HTTP/1.1 100 Continue\r\n\r\n")
        cpio = CpioReader(self.folder, self.user)
        if kind == "application/x-cpio":
            gunzip = zlib.decompressobj(47)      # gzip or zlib, detected
            feed = lambda data: cpio.feed(gunzip.decompress(data))
        else:
            feed = DvzipReader(cpio.feed).feed
        total = 0
        for piece in connection.body_chunks(headers):
            total += len(piece)
            feed(piece)
        connection.reply(200, "OK", close=True)
        log(f"{who}: received {total} bytes: {', '.join(os.path.basename(p) for p in cpio.saved) or 'nothing'}")
        self.on_event("saved", cpio.saved)


def certificate(folder, name, user):
    os.makedirs(folder, exist_ok=True)
    cert, key = os.path.join(folder, "certificate.pem"), os.path.join(folder, "key.pem")
    if not (os.path.exists(cert) and os.path.exists(key)):
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "3650",
                        "-keyout", key, "-out", cert, "-subj", f"/CN={name}"],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for path in (folder, cert, key):
            give(path, user)
    return cert, key


# --- running it -------------------------------------------------------------------------------------------------------

def link_local(interface, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with open("/proc/net/if_inet6") as f:
                for line in f:
                    fields = line.split()
                    if fields[5] == interface and fields[0].startswith("fe80"):
                        raw = fields[0]
                        return socket.inet_ntop(socket.AF_INET6, bytes.fromhex(raw))
        except OSError:
            pass
        time.sleep(0.2)
    return None


def ping_neighbours():
    """An ICMPv6 echo to every AWDL neighbour every 3 s: peers learn us from it, and its acknowledgement shows that
    the iPhone hears our frames."""
    while True:
        out = subprocess.run(["ip", "-6", "neigh", "show", "dev", "awdl0", "nud", "permanent"], capture_output=True, text=True).stdout
        for line in out.splitlines():
            address = line.split()[0] if line.strip() else None
            if address and address.startswith("fe80"):
                subprocess.run(["ping", "-6", "-c", "1", "-W", "1", f"{address}%awdl0"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(3)


def safe_host(name):
    keep = "".join(c if c.isalnum() else "-" for c in name).strip("-")
    return keep[:40] or "osmin"


def receive(args):
    if os.geteuid() != 0:
        sys.exit("needs root: sudo python3 airdrop/osmin_airdrop.py receive")
    user = owner()
    folder = os.path.abspath(os.path.expanduser(args.dir.replace("~", user.pw_dir, 1) if args.dir.startswith("~") else args.dir))
    os.makedirs(folder, exist_ok=True)
    give(folder, user)
    pretty = args.name or (subprocess.run(["hostnamectl", "--pretty"], capture_output=True, text=True).stdout.strip()
                           or socket.gethostname())
    host = safe_host(socket.gethostname())
    instance = "%012x" % random.getrandbits(48)
    cert, key = certificate(os.path.join(user.pw_dir, ".local/share/osmin/airdrop"), pretty, user)

    daemon_path = os.path.join(HERE, "build", "osmin-awdld")
    if not os.path.exists(daemon_path):
        sys.exit("build it first: scripts/build-airdrop.sh")
    command = [daemon_path, "--channel", str(args.channel), "--name", host,
               "--service", instance, "--port", str(AIRDROP_PORT), "--txt", f"flags={FLAGS}"]
    if args.take_card:
        command.append("--take-card")
    if args.verbose:
        command.append("--verbose")
    if args.capture:
        captures = os.path.join(HERE, "captures")
        os.makedirs(captures, exist_ok=True)
        os.chmod(captures, 0o777)
        path = os.path.join(captures, time.strftime("awdl-%Y%m%d-%H%M%S.pcap"))
        command += ["--capture", path]
    if args.take_card:
        log("--take-card: Wi-Fi leaves the network and disappears from the panel while this runs; Ctrl+C gives it back")
    daemon = subprocess.Popen(command)
    firewall = []
    try:
        address = link_local("awdl0")
        if not address:
            sys.exit("awdl0 did not come up (see the lines of osmin-awdld above)")
        log(f"awdl0 {address}; files go to {folder}; this computer shows as \"{pretty}\" (instance {instance})")
        # the firewall (ufw) may drop what comes in on awdl0: let it in while we run
        for rule in (["ip6tables", "-I", "INPUT", "1", "-i", "awdl0", "-j", "ACCEPT"],):
            if subprocess.run(rule, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                firewall.append(rule)
        scope = socket.if_nametoindex("awdl0")
        mdns = Mdns("awdl0", address, instance, host, AIRDROP_PORT)
        threading.Thread(target=mdns.run, daemon=True).start()
        receiver = Receiver(pretty, folder, user, cert, key, ask=args.ask)
        threading.Thread(target=receiver.serve, args=("::", AIRDROP_PORT, 0), daemon=True).start()
        threading.Thread(target=ping_neighbours, daemon=True).start()
        log("ready: open the share sheet on the iPhone, AirDrop on Everyone for 10 minutes; Ctrl+C to stop")
        stop = threading.Event()
        signal.signal(signal.SIGINT, lambda *a: stop.set())
        signal.signal(signal.SIGTERM, lambda *a: stop.set())
        while not stop.is_set() and daemon.poll() is None:
            stop.wait(0.5)
        mdns.stopped = receiver.stopped = True
        del scope
    finally:
        for rule in firewall:
            subprocess.run([part if part != "-I" else "-D" for part in rule if part != "1"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if daemon.poll() is None:
            daemon.send_signal(signal.SIGINT)
            try:
                daemon.wait(5)
            except subprocess.TimeoutExpired:
                daemon.kill()


def main():
    parser = argparse.ArgumentParser(description="AirDrop for Osmin")
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("receive", help="be visible to iPhones and receive files")
    r.add_argument("--dir", default="~/Downloads", help="where received files go")
    r.add_argument("--name", help="the name iPhones show (default: the computer's name)")
    r.add_argument("--channel", type=int, default=149)
    r.add_argument("--take-card", action="store_true", help="leave the Wi-Fi network while running (AWDL on --channel)")
    r.add_argument("--ask", action="store_true", help="ask in the terminal before accepting")
    r.add_argument("--verbose", action="store_true")
    r.add_argument("--capture", action="store_true", help="save every AWDL frame to airdrop/captures/*.pcap")
    args = parser.parse_args()
    if args.command == "receive":
        receive(args)


if __name__ == "__main__":
    main()
