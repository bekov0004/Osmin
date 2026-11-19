#!/usr/bin/env python3
"""Reads an AWDL capture (radiotap pcap) made by osmin-awdld --capture and tells what the Apple devices did."""
import struct
import sys
from collections import Counter, defaultdict

BSSID = bytes.fromhex("002500ff9473")
TLV_NAMES = {0: "ssth", 1: "svc-req", 2: "svc-resp", 4: "sync", 5: "elect", 6: "service", 7: "ht", 12: "datapath",
             16: "arpa", 17: "80211", 18: "chanseq", 19: "t19", 20: "synctree", 21: "version", 22: "bloom", 24: "elect2"}


def frames(path):
    data = open(path, "rb").read()
    at = 24
    while at + 16 <= len(data):
        sec, usec, incl, orig = struct.unpack("<IIII", data[at:at + 16])
        yield sec + usec / 1e6, data[at + 16:at + 16 + incl]
        at += 16 + incl


def radiotap(p):
    n = struct.unpack("<H", p[2:4])[0]
    present = struct.unpack("<I", p[4:8])[0]
    fcs = False
    rssi = None
    off = 8
    w = present
    while w & 0x80000000:
        w = struct.unpack("<I", p[off:off + 4])[0]
        off += 4
    for bit, size, align in ((0, 8, 8), (1, 1, 1), (2, 1, 1), (3, 4, 2), (4, 2, 1), (5, 1, 1)):
        if present & (1 << bit):
            off = (off + align - 1) & ~(align - 1)
            if bit == 1 and p[off] & 0x10:
                fcs = True
            if bit == 5:
                rssi = struct.unpack("b", p[off:off + 1])[0]
            off += size
    return n, fcs, rssi


def tlvs(body):
    out = []
    at = 16
    while at + 3 <= len(body):
        t = body[at]
        l = struct.unpack("<H", body[at + 1:at + 3])[0]
        out.append((t, body[at + 3:at + 3 + l]))
        at += 3 + l
    return out


def mac(b):
    return ":".join(f"{x:02x}" for x in b)


def main(path, me=None):
    stats = Counter()
    by_src = defaultdict(list)
    data_frames = []
    for ts, p in frames(path):
        n, fcs, rssi = radiotap(p)
        f = p[n:len(p) - (4 if fcs else 0)]
        if len(f) < 24:
            continue
        fc0, fc1 = f[0], f[1]
        src = f[10:16]
        if fc0 & 0xfc == 0xd0 and len(f) > 40 and f[24] == 127 and f[25:28] == b"\x00\x17\xf2":
            body = f[24:]
            by_src[mac(src)].append((ts, body[6], body, rssi))
            stats["action"] += 1
        elif fc0 & 0x0c == 0x08 and f[16:22] == BSSID:
            data_frames.append((ts, mac(src), mac(f[4:10]), fc0, fc1, f, rssi))
            stats["data"] += 1
    print(path, dict(stats))
    for s, items in by_src.items():
        kinds = Counter("MIF" if k == 3 else "PSF" if k == 0 else str(k) for _, k, _, _ in items)
        print(f"\n== {s}: {len(items)} action frames {dict(kinds)}, first {items[0][0]:.3f} last {items[-1][0]:.3f}")
    return by_src, data_frames


if __name__ == "__main__":
    main(sys.argv[1])
