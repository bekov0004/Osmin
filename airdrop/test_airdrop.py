"""Tests of osmin_airdrop.py without a radio: a fake iPhone talks to the server over TLS on the loopback."""
import gzip
import os
import plistlib
import pwd
import socket
import ssl
import struct
import sys
import tempfile
import threading
import time
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import osmin_airdrop as ad


def chunked(data, size=1000):
    out = b""
    for i in range(0, len(data), size):
        piece = data[i:i + size]
        out += b"%x\r\n" % len(piece) + piece + b"\r\n"
    return out + b"0\r\n\r\n"


class Phone:
    def __init__(self, port):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        raw = socket.create_connection(("::1", port))
        self.s = context.wrap_socket(raw)
        self.buffer = b""

    def read_response(self):
        while b"\r\n\r\n" not in self.buffer:
            self.buffer += self.s.recv(65536)
        head, self.buffer = self.buffer.split(b"\r\n\r\n", 1)
        lines = head.decode().split("\r\n")
        status = int(lines[0].split()[1])
        headers = {l.split(":", 1)[0].lower(): l.split(":", 1)[1].strip() for l in lines[1:]}
        n = int(headers.get("content-length", "0"))
        while len(self.buffer) < n:
            self.buffer += self.s.recv(65536)
        body, self.buffer = self.buffer[:n], self.buffer[n:]
        return status, headers, body

    def post(self, path, body, extra=b"", chunk=True):
        head = b"POST " + path.encode() + b" HTTP/1.1\r\nUser-Agent: AirDrop/1.0\r\nConnection: keep-alive\r\n" + extra
        if chunk:
            self.s.sendall(head + b"Transfer-Encoding: chunked\r\n\r\n" + chunked(body))
        else:
            self.s.sendall(head + b"Content-Length: %d\r\n\r\n" % len(body) + body)
        return self.read_response()


def main():
    tmp = tempfile.mkdtemp()
    user = pwd.getpwuid(os.getuid())
    cert, key = ad.certificate(os.path.join(tmp, "keys"), "Test", user)
    out = os.path.join(tmp, "in")
    os.makedirs(out)
    events = []
    receiver = ad.Receiver("ProBook of Test", out, user, cert, key, on_event=lambda *a: events.append(a))
    port = 18771
    threading.Thread(target=receiver.serve, args=("::1", port), daemon=True).start()
    time.sleep(0.3)

    # /Discover on its own connection
    p = Phone(port)
    status, _, body = p.post("/Discover", plistlib.dumps({}, fmt=plistlib.FMT_BINARY), chunk=False)
    answer = plistlib.loads(body)
    assert status == 200 and answer["ReceiverComputerName"] == "ProBook of Test", answer
    assert b"Version" in answer["ReceiverMediaCapabilities"]

    # /Ask then /Upload on one connection, the upload chunked, gzip'd cpio, with Expect: 100-continue
    p = Phone(port)
    photo = os.urandom(300000)
    ask = {"TransferID": {"id": "ABC"}, "SenderComputerName": "Anushervon's iPhone", "SenderModelName": "iPhone16,1",
           "SenderID": "0123456789ab", "BundleID": "com.apple.photos", "ConvertMediaFormats": False,
           "Files": [{"FileName": "IMG_0001.HEIC", "FileType": "public.heic", "FileBomPath": "./IMG_0001.HEIC",
                      "FileIsDirectory": False, "ConvertMediaFormats": False}]}
    status, _, body = p.post("/Ask", plistlib.dumps(ask, fmt=plistlib.FMT_BINARY))
    assert status == 200 and plistlib.loads(body)["ReceiverComputerName"] == "ProBook of Test"
    archive = gzip.compress(ad.cpio_archive([("IMG_0001.HEIC", photo), ("../evil.txt", b"x"), ("._IMG_0001.HEIC", b"meta")]))
    head = (b"POST /Upload HTTP/1.1\r\nContent-Type: application/x-cpio\r\nExpect: 100-continue\r\n"
            b"Transfer-Encoding: chunked\r\nTransferID: ABC\r\n\r\n")
    p.s.sendall(head)
    first = p.s.recv(100)
    assert first.startswith(b"HTTP/1.1 100 Continue"), first
    p.s.sendall(chunked(archive, 7000))
    status, headers, _ = p.read_response()
    assert status == 200 and headers["connection"] == "close"
    time.sleep(0.2)
    saved = sorted(os.listdir(out))
    assert saved == ["IMG_0001.HEIC"], saved     # a path with ".." refused, AppleDouble skipped
    assert open(os.path.join(out, "IMG_0001.HEIC"), "rb").read() == photo

    # the same name again: a free name
    p = Phone(port)
    p.post("/Ask", plistlib.dumps(ask, fmt=plistlib.FMT_BINARY))
    p.s.sendall(b"POST /Upload HTTP/1.1\r\nContent-Type: application/x-cpio\r\nContent-Length: %d\r\n\r\n" % len(archive) + archive)
    assert p.read_response()[0] == 200
    time.sleep(0.2)
    assert "IMG_0001 (1).HEIC" in os.listdir(out)

    # DVZip upload
    p = Phone(port)
    p.post("/Ask", plistlib.dumps(ask, fmt=plistlib.FMT_BINARY))
    raw = ad.cpio_archive([("note.txt", b"hello dvzip" * 1000)])
    dv = b""
    for i in range(0, len(raw), 4096):
        z = zlib.compress(raw[i:i + 4096])
        dv += struct.pack(">I", len(z)) + z
    status, _, _ = p.post("/Upload", dv, b"Content-Type: application/x-dvzip\r\n")
    assert status == 200
    time.sleep(0.2)
    assert open(os.path.join(out, "note.txt"), "rb").read() == b"hello dvzip" * 1000

    # a link
    p = Phone(port)
    status, _, _ = p.post("/Ask", plistlib.dumps({"SenderComputerName": "x", "Items": ["https://example.com/a"]}, fmt=plistlib.FMT_BINARY))
    assert status == 200
    time.sleep(0.1)
    assert "https://example.com/a" in open(os.path.join(out, "AirDrop links.txt")).read()

    # upload without ask: refused; unknown type: 406
    p = Phone(port)
    assert p.post("/Upload", b"x", b"Content-Type: application/x-cpio\r\n")[0] == 403
    p = Phone(port)
    p.post("/Ask", plistlib.dumps(ask, fmt=plistlib.FMT_BINARY))
    assert p.post("/Upload", b"x", b"Content-Type: application/zip\r\n")[0] == 406

    # mDNS: our answer parses, and questions about us are recognised
    m = ad.Mdns.__new__(ad.Mdns)
    m.address, m.instance, m.host, m.port = "fe80::ae50:deff:fecf:cdc9", "a1b2c3d4e5f6." + ad.SERVICE, "ProBook.local.", 8771
    packet = m.answer()
    assert struct.unpack(">HHHHHH", packet[:12])[3] == 4
    name, _ = ad.read_name(packet, 12)
    assert name == ad.SERVICE
    query = struct.pack(">HHHHHH", 0, 0, 1, 0, 0, 0) + ad.dns_name("_airdrop._tcp.local") + struct.pack(">HH", 12, 1)
    assert m.wanted(query)
    other = struct.pack(">HHHHHH", 0, 0, 1, 0, 0, 0) + ad.dns_name("_companion-link._tcp.local") + struct.pack(">HH", 12, 1)
    assert not m.wanted(other)
    assert [e[0] for e in events].count("discover") == 1
    print("airdrop ok")


if __name__ == "__main__":
    main()
