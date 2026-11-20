#include "awdl.h"

#include <stdio.h>
#include <string.h>

static uint16_t le16(const uint8_t *p) { return (uint16_t)(p[0] | p[1] << 8); }
static uint32_t le32(const uint8_t *p) { return (uint32_t)(p[0] | p[1] << 8 | p[2] << 16 | (uint32_t)p[3] << 24); }
static void put16(uint8_t *p, uint16_t v) { p[0] = v & 0xff; p[1] = v >> 8; }
static void put32(uint8_t *p, uint32_t v) { p[0] = v & 0xff; p[1] = v >> 8 & 0xff; p[2] = v >> 16 & 0xff; p[3] = v >> 24; }

static const uint8_t SNAP[8] = {0xaa, 0xaa, 0x03, 0x00, 0x17, 0xf2, 0x08, 0x00};

/* Radiotap: walks the present fields up to the signal strength; sets *fcs when the frame still ends with its FCS. */
static size_t radiotap(const uint8_t *p, size_t length, int *rssi, int *fcs)
{
    *rssi = 0;
    *fcs = 0;
    if (length < 8 || p[0] != 0)
        return 0;
    size_t header = le16(p + 2);
    if (header > length || header < 8)
        return 0;
    size_t offset = 4;
    uint32_t present = le32(p + 4);
    uint32_t word = present;
    while (word & 0x80000000u) {
        offset += 4;
        if (offset + 4 > header)
            return header;
        word = le32(p + offset);
    }
    offset += 4;
    static const struct { int bit, size, align; } fields[] = {
        {0, 8, 8}, {1, 1, 1}, {2, 1, 1}, {3, 4, 2}, {4, 2, 1}, {5, 1, 1},
    };
    for (size_t i = 0; i < sizeof(fields) / sizeof(fields[0]); i++) {
        if (!(present & (1u << fields[i].bit)))
            continue;
        offset = (offset + fields[i].align - 1) & ~(size_t)(fields[i].align - 1);
        if (offset + fields[i].size > header)
            break;
        if (fields[i].bit == 1 && (p[offset] & 0x10))
            *fcs = 1;
        if (fields[i].bit == 5)
            *rssi = (int8_t)p[offset];
        offset += fields[i].size;
    }
    return header;
}

/* A DNS name in the ARPA TLV: labels, ended by 0 or a compression pointer (the ".local" the frames point at). */
static void dns_name(const uint8_t *p, size_t length, char *out, size_t size)
{
    size_t at = 0, written = 0;
    out[0] = 0;
    while (at < length) {
        uint8_t n = p[at++];
        if (n == 0 || n >= 0xc0 || at + n > length)
            break;
        if (written && written + 1 < size)
            out[written++] = '.';
        for (uint8_t i = 0; i < n && written + 1 < size; i++)
            out[written++] = (char)p[at + i];
        at += n;
    }
    out[written < size ? written : size - 1] = 0;
}

/* The channel sequence (TLV 18, also at the end of the sync parameters): one channel per slot. */
static int parse_chanseq(const uint8_t *v, size_t len, uint8_t out[AWDL_SLOTS])
{
    if (len < 6)
        return 0;
    int count = v[0] + 1;
    int encoding = v[1];
    int width = encoding == 0 ? 1 : 2;
    if (count > AWDL_SLOTS)
        count = AWDL_SLOTS;
    if (6 + (size_t)count * width > len)
        return 0;
    memset(out, 0, AWDL_SLOTS);
    for (int i = 0; i < count; i++) {
        const uint8_t *c = v + 6 + i * width;
        /* simple: channel; legacy: flags, channel; opclass: channel, class */
        out[i] = encoding == 1 ? c[1] : c[0];
    }
    return 1;
}

int awdl_parse(const uint8_t *packet, size_t length, struct awdl_frame *out)
{
    int rssi, fcs;
    size_t rt = radiotap(packet, length, &rssi, &fcs);
    if (!rt)
        return 0;
    const uint8_t *f = packet + rt;
    size_t n = length - rt - (fcs ? 4 : 0);
    /* management (type 0), action (subtype 13): frame control 0xd0 */
    if (length < rt + 4 || n < 24 + 16 || (f[0] & 0xfc) != 0xd0)
        return 0;
    const uint8_t *body = f + 24;
    if (body[0] != AWDL_CATEGORY || memcmp(body + 1, AWDL_OUI, 3) != 0 || body[4] != AWDL_TYPE)
        return 0;
    memset(out, 0, sizeof(*out));
    out->devclass = -1;
    out->awdl_version = -1;
    out->rssi = rssi;
    memcpy(out->src, f + 10, 6);
    out->version = body[5];
    out->subtype = body[6];
    out->phy_tx_time = le32(body + 8);
    out->target_tx_time = le32(body + 12);

    int v2 = 0;
    size_t at = 16;
    size_t total = n - 24;
    while (at + 3 <= total) {
        uint8_t type = body[at];
        uint16_t len = le16(body + at + 1);
        const uint8_t *v = body + at + 3;
        if (at + 3 + len > total)
            break;
        if (out->n_tlvs < (int)sizeof(out->tlvs))
            out->tlvs[out->n_tlvs++] = type;
        switch (type) {
        case AWDL_TLV_ARPA:
            if (len > 1)
                dns_name(v + 1, len - 1, out->hostname, sizeof(out->hostname));
            break;
        case AWDL_TLV_VERSION:
            if (len >= 2) {
                out->awdl_version = v[0];
                out->devclass = v[1];
            }
            break;
        case AWDL_TLV_SYNC_PARAMS:
            if (len >= 31) {
                out->has_sync = 1;
                out->next_aw_channel = v[0];
                out->tx_counter = le16(v + 1);
                out->master_channel = v[3];
                out->aw_period = le16(v + 5);
                memcpy(out->sync_master, v + 21, 6);
                out->aw_seq = le16(v + 29);
                if (!out->has_chanseq && len > 33)
                    out->has_chanseq = parse_chanseq(v + 33, len - 33, out->chanseq);
            }
            break;
        case AWDL_TLV_CHAN_SEQ:
            out->has_chanseq = parse_chanseq(v, len, out->chanseq) || out->has_chanseq;
            break;
        case AWDL_TLV_ELECTION_PARAMS:
            if (len >= 19 && !v2) {
                out->has_election = 1;
                out->distance = v[3];
                memcpy(out->master, v + 5, 6);
                out->master_metric = le32(v + 11);
                out->self_metric = le32(v + 15);
            }
            break;
        case AWDL_TLV_ELECTION_PARAMS_V2:
            if (len >= 40) {
                v2 = 1;
                out->has_election = 1;
                memcpy(out->master, v, 6);
                out->master_counter = le32(v + 12);
                out->distance = le32(v + 16);
                out->master_metric = le32(v + 20);
                out->self_metric = le32(v + 24);
            }
            break;
        default:
            break;
        }
        at += 3 + len;
    }
    return 1;
}

static size_t tlv(uint8_t *p, uint8_t type, const uint8_t *value, uint16_t length)
{
    p[0] = type;
    put16(p + 1, length);
    memcpy(p + 3, value, length);
    return 3 + (size_t)length;
}

/* CRC-8 (polynomial 0x07, start 0) of a name in DNS wire format: what the Service Parameters TLV is made of. */
uint8_t awdl_name_crc(const char *name)
{
    uint8_t wire[160];
    size_t n = 0;
    const char *at = name;
    while (*at && n < sizeof(wire) - 66) {
        const char *dot = strchr(at, '.');
        size_t len = dot ? (size_t)(dot - at) : strlen(at);
        wire[n++] = (uint8_t)len;
        memcpy(wire + n, at, len);
        n += len;
        at += len + (dot ? 1 : 0);
    }
    wire[n++] = 0;
    uint8_t c = 0;
    for (size_t i = 0; i < n; i++) {
        c ^= wire[i];
        for (int b = 0; b < 8; b++)
            c = (uint8_t)(c & 0x80 ? (c << 1) ^ 0x07 : c << 1);
    }
    return c;
}

/* Service Parameters: 3 reserved bytes, the update counter, a bitmask of which groups of 8 values are present, then a
 * byte for each such group with the values' bits. The values: the CRC-8 of each record name we answer for. */
static size_t service_params(uint8_t *p, const struct awdl_self *self)
{
    uint8_t v[48];
    memset(v, 0, sizeof(v));
    uint8_t groups[32];
    memset(groups, 0, sizeof(groups));
    if (self->service[0]) {
        char instance[96];
        snprintf(instance, sizeof(instance), "%s._airdrop._tcp.local", self->service);
        uint8_t values[2] = {awdl_name_crc("_airdrop._tcp.local"), awdl_name_crc(instance)};
        for (int i = 0; i < 2; i++)
            groups[values[i] / 8] |= (uint8_t)(1 << (values[i] % 8));
        put16(v + 3, 1);                  /* update counter */
    }
    uint32_t mask = 0;
    size_t n = 9;
    for (int g = 0; g < 32; g++) {
        if (groups[g]) {
            mask |= 1u << g;
            v[n++] = groups[g];
        }
    }
    put32(v + 5, mask);
    return tlv(p, AWDL_TLV_SERVICE_PARAMS, v, (uint16_t)n);
}

/* Radiotap (no fields) and the 802.11 header of an action frame to everyone in the AWDL BSS. */
static uint8_t *action_header(uint8_t *p, const uint8_t mac[6], uint16_t sequence, int subtype, uint32_t tx_time_us)
{
    memset(p, 0, 8);
    p[2] = 8;
    p += 8;
    p[0] = 0xd0;
    p[1] = 0;
    put16(p + 2, 0);
    memcpy(p + 4, BROADCAST, 6);
    memcpy(p + 10, mac, 6);
    memcpy(p + 16, AWDL_BSSID, 6);
    put16(p + 22, (uint16_t)(sequence << 4));
    p += 24;
    p[0] = AWDL_CATEGORY;
    memcpy(p + 1, AWDL_OUI, 3);
    p[4] = AWDL_TYPE;
    p[5] = AWDL_VERSION_1;
    p[6] = (uint8_t)subtype;
    p[7] = 0;
    put32(p + 8, tx_time_us);
    put32(p + 12, tx_time_us);
    return p + 16;
}

/* Our channel sequence: the one channel in every slot (opclass encoding), then 3 bytes of padding. */
static size_t chanseq(uint8_t *v, const struct awdl_self *self)
{
    v[0] = AWDL_SLOTS - 1;
    v[1] = 3;                 /* encoding: channel, operating class */
    v[2] = 0;                 /* duplicate count */
    v[3] = AWDL_AWS_PER_SLOT - 1;
    put16(v + 4, 0xffff);     /* fill channel */
    for (int i = 0; i < AWDL_SLOTS; i++) {
        v[6 + i * 2] = self->channel;
        v[7 + i * 2] = self->opclass;
    }
    memset(v + 6 + AWDL_SLOTS * 2, 0, 3);
    return 6 + AWDL_SLOTS * 2 + 3;
}

size_t awdl_build_action(uint8_t *buffer, size_t size, const struct awdl_self *self, int subtype, uint16_t sequence,
    uint32_t tx_time_us)
{
    if (size < 512)
        return 0;
    uint8_t *p = action_header(buffer, self->mac, sequence, subtype, tx_time_us);
    uint8_t v[96];

    /* 4: sync parameters */
    memset(v, 0, sizeof(v));
    v[0] = self->channel;
    put16(v + 1, self->tx_counter);
    v[3] = 0;                 /* master channel: iPhones send 0 */
    v[4] = 0;
    put16(v + 5, AWDL_AW_TU);
    put16(v + 7, AWDL_AF_PERIOD_TU);
    put16(v + 9, 0x1800);
    put16(v + 11, AWDL_AW_TU);
    put16(v + 13, AWDL_AW_TU);
    put16(v + 15, 0);         /* remaining AW length: iPhones send 0 */
    v[17] = v[18] = v[19] = v[20] = 3;
    memcpy(v + 21, self->master, 6);
    v[27] = 4;
    v[28] = 0;
    put16(v + 29, self->aw_seq);
    put16(v + 31, 0);
    /* inside the sync parameters iPhones write the channel sequence in the legacy encoding (flags, channel) */
    uint8_t *c = v + 33;
    c[0] = AWDL_SLOTS - 1;
    c[1] = 1;
    c[2] = 0;
    c[3] = AWDL_AWS_PER_SLOT - 1;
    put16(c + 4, 0xffff);
    for (int i = 0; i < AWDL_SLOTS; i++) {
        c[6 + i * 2] = self->legacy_flags;
        c[7 + i * 2] = self->legacy_channel;
    }
    c[6 + AWDL_SLOTS * 2] = c[7 + AWDL_SLOTS * 2] = 0;
    size_t sync_len = 33 + 6 + AWDL_SLOTS * 2 + 2;
    p += tlv(p, AWDL_TLV_SYNC_PARAMS, v, (uint16_t)sync_len);

    /* 5: election parameters (v1) */
    memset(v, 0, sizeof(v));
    v[3] = (uint8_t)self->distance;
    memcpy(v + 5, self->master, 6);
    put32(v + 11, self->master_metric);
    put32(v + 15, self->self_metric);
    p += tlv(p, AWDL_TLV_ELECTION_PARAMS, v, 21);

    /* 18: channel sequence */
    p += tlv(p, AWDL_TLV_CHAN_SEQ, v, (uint16_t)chanseq(v, self));

    /* 24: election parameters v2 */
    memset(v, 0, sizeof(v));
    memcpy(v, self->master, 6);
    memcpy(v + 6, self->sync_from, 6);
    put32(v + 12, self->master_counter);
    put32(v + 16, self->distance);
    put32(v + 20, self->master_metric);
    put32(v + 24, self->self_metric);
    put32(v + 36, self->self_counter);
    p += tlv(p, AWDL_TLV_ELECTION_PARAMS_V2, v, 40);

    /* 12: data path state, laid out as an iPhone's: country, social channels, infrastructure BSSID (zero) and channel,
     * infrastructure address (ours), unicast options (4 zero bytes); flags: dual band */
    memset(v, 0, sizeof(v));
    put16(v, 0x0100 | 0x0200 | 0x0001 | 0x0002 | 0x0020 | 0x1000);
    v[2] = self->country[0] ? (uint8_t)self->country[0] : 'U';
    v[3] = self->country[1] ? (uint8_t)self->country[1] : 'S';
    v[4] = 0;
    put16(v + 5, 0x0007);
    memset(v + 7, 0, 6);
    put16(v + 13, self->channel);
    memcpy(v + 15, self->mac, 6);
    put16(v + 21, 4);
    memset(v + 23, 0, 4);
    p += tlv(p, AWDL_TLV_DATA_PATH_STATE, v, 27);

    /* 7: HT capabilities (as an iPhone's, one stream) */
    const uint8_t ht[9] = {0x00, 0x00, 0x6f, 0x00, 0x1f, 0xff, 0x00, 0x00, 0x00};
    p += tlv(p, AWDL_TLV_HT_CAPS, ht, sizeof(ht));

    /* 17: an 802.11 VHT Capabilities element (one stream, MCS 0-9) */
    const uint8_t vht[14] = {0xbf, 0x0c, 0x36, 0x00, 0x80, 0x03, 0xfe, 0xff, 0x00, 0x00, 0xfe, 0xff, 0x00, 0x00};
    p += tlv(p, AWDL_TLV_IEEE80211_CONTAINER, vht, sizeof(vht));

    /* 33: unknown, new in current iPhones; theirs, with our channel */
    uint8_t t33[14] = {0x01, 0x00, 0x00, 0x00, 0x00, 0x7f, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
    t33[4] = self->channel;
    p += tlv(p, 33, t33, sizeof(t33));

    /* 16: ARPA (MIF only): our name, then "local" from the dictionary */
    if (subtype == AWDL_SUBTYPE_MIF) {
        size_t name = strnlen(self->hostname, 60);
        v[0] = 3;
        v[1] = (uint8_t)name;
        memcpy(v + 2, self->hostname, name);
        v[2 + name] = 0xc0;
        v[3 + name] = 0x0c;
        p += tlv(p, AWDL_TLV_ARPA, v, (uint16_t)(name + 4));
    }

    /* 21: version: the AWDL version current iPhones send (0xa2), a Mac */
    v[0] = 0xa2;
    v[1] = AWDL_DEV_MACOS;
    p += tlv(p, AWDL_TLV_VERSION, v, 2);

    /* 6: service parameters: which record names we answer for, as a set of their CRC-8 values */
    p += service_params(p, self);

    /* 2: our AirDrop service, as mDNS records (PTR, SRV, TXT) */
    if (subtype == AWDL_SUBTYPE_MIF && self->service[0]) {
        char instance[96], target[96];
        snprintf(instance, sizeof(instance), "%s._airdrop._tcp.local", self->service);
        snprintf(target, sizeof(target), "%s.local", self->hostname);
        uint8_t rdata[200];
        /* PTR: the instance's own label, then the "same name" mark (0xC000), as iPhones send it */
        size_t label = strnlen(self->service, 31);
        rdata[0] = (uint8_t)label;
        memcpy(rdata + 1, self->service, label);
        rdata[1 + label] = 0xc0;
        rdata[2 + label] = 0x00;
        size_t n = label + 3;
        p += awdl_service_record(p, "_airdrop._tcp.local", 12, rdata, n);
        rdata[0] = rdata[1] = rdata[2] = rdata[3] = 0;          /* priority, weight */
        rdata[4] = (uint8_t)(self->service_port >> 8);
        rdata[5] = (uint8_t)self->service_port;
        n = 6 + awdl_dns_encode(target, rdata + 6, sizeof(rdata) - 6);
        p += awdl_service_record(p, instance, 33, rdata, n);
        size_t t = strnlen(self->txt, 60);
        rdata[0] = (uint8_t)t;
        memcpy(rdata + 1, self->txt, t);
        p += awdl_service_record(p, instance, 16, rdata, t + 1);
    }
    return (size_t)(p - buffer);
}

size_t awdl_service_record(uint8_t *p, const char *name, uint8_t type, const uint8_t *rdata, size_t length)
{
    uint8_t encoded[128];
    size_t n = awdl_dns_encode(name, encoded, sizeof(encoded));
    if (!n)
        return 0;
    size_t value = 2 + n + 1 + 2 + 2 + length;
    p[0] = AWDL_TLV_SERVICE_RESPONSE;
    put16(p + 1, (uint16_t)value);
    uint8_t *v = p + 3;
    put16(v, (uint16_t)(n + 1));          /* the name and the type byte */
    memcpy(v + 2, encoded, n);
    v[2 + n] = type;
    put16(v + 3 + n, (uint16_t)length);   /* the record data */
    put16(v + 5 + n, 0);                  /* two bytes of unknown meaning */
    memcpy(v + 7 + n, rdata, length);
    return 3 + value;
}

size_t awdl_build_psf(uint8_t *buffer, size_t size, const uint8_t mac[6], const char *hostname, uint16_t sequence)
{
    if (size < 256)
        return 0;
    uint8_t *p = action_header(buffer, mac, sequence, AWDL_SUBTYPE_PSF, 0);
    const uint8_t version[2] = {0x34, AWDL_DEV_MACOS};
    p += tlv(p, AWDL_TLV_VERSION, version, sizeof(version));
    uint8_t arpa[70];
    size_t name = strnlen(hostname, 60);
    arpa[0] = 3;
    arpa[1] = (uint8_t)name;
    memcpy(arpa + 2, hostname, name);
    arpa[2 + name] = 0xc0;
    arpa[3 + name] = 0x0c;
    p += tlv(p, AWDL_TLV_ARPA, arpa, (uint16_t)(name + 4));
    return (size_t)(p - buffer);
}

size_t awdl_wrap_data(uint8_t *buffer, size_t size, const uint8_t *ether, size_t length, uint16_t sequence)
{
    if (length < 14 || 11 + 24 + 8 + 8 + (length - 14) > size)
        return 0;
    uint8_t *p = buffer;
    /* radiotap: TX flags (0: an acknowledgement is wanted) and at most 2 retries, so that a frame the peer misses
     * does not hold the card's queue for long */
    static const uint8_t rt[11] = {0x00, 0x00, 0x0b, 0x00, 0x00, 0x80, 0x02, 0x00, 0x00, 0x00, 0x02};
    memcpy(p, rt, sizeof(rt));
    p += sizeof(rt);
    /* data frame, no DS bits: receiver, transmitter, BSSID */
    p[0] = 0x08;
    p[1] = 0;
    put16(p + 2, 0);
    memcpy(p + 4, ether, 6);
    memcpy(p + 10, ether + 6, 6);
    memcpy(p + 16, AWDL_BSSID, 6);
    put16(p + 22, (uint16_t)(sequence << 4));
    p += 24;
    memcpy(p, SNAP, 8);
    p += 8;
    /* AWDL data header: 0x0403, sequence, padding, ethertype (big endian, as in the Ethernet frame) */
    put16(p, 0x0403);
    put16(p + 2, sequence);
    put16(p + 4, 0);
    p[6] = ether[12];
    p[7] = ether[13];
    p += 8;
    memcpy(p, ether + 14, length - 14);
    p += length - 14;
    return (size_t)(p - buffer);
}

/* One body (from the SNAP header on) as an Ethernet frame. */
static int deliver_body(const uint8_t *dst, const uint8_t *src, const uint8_t *body, size_t length, awdl_deliver deliver,
    void *context)
{
    if (length < 16 || memcmp(body, SNAP, 8) != 0 || le16(body + 8) != 0x0403)
        return 0;
    uint8_t ether[2400];
    size_t payload = length - 16;
    if (14 + payload > sizeof(ether))
        return 0;
    memcpy(ether, dst, 6);
    memcpy(ether + 6, src, 6);
    ether[12] = body[14];
    ether[13] = body[15];
    memcpy(ether + 14, body + 16, payload);
    deliver(ether, 14 + payload, context);
    return 1;
}

int awdl_unwrap_data(const uint8_t *packet, size_t length, uint8_t src[6], awdl_deliver deliver, void *context)
{
    int rssi, fcs;
    size_t rt = radiotap(packet, length, &rssi, &fcs);
    if (!rt || length < rt + 24)
        return 0;
    const uint8_t *f = packet + rt;
    size_t n = length - rt - (fcs ? 4 : 0);
    /* data frames (type 2): plain (subtype 0) or QoS (subtype 8); no DS bits; the AWDL BSSID */
    if ((f[0] & 0x0c) != 0x08 || (f[1] & 0x03) != 0 || memcmp(f + 16, AWDL_BSSID, 6) != 0)
        return 0;
    int qos = (f[0] & 0x80) != 0;
    size_t header = 24 + (qos ? 2 : 0);
    if (f[1] & 0x80)          /* order bit: an HT control field follows */
        header += 4;
    if (n <= header)
        return 0;
    if (src)
        memcpy(src, f + 10, 6);
    const uint8_t *body = f + header;
    size_t body_len = n - header;
    int amsdu = qos && (f[24] & 0x80);
    if (!amsdu)
        return deliver_body(f + 4, f + 10, body, body_len, deliver, context);
    /* A-MSDU: subframes of DA, SA, length (big endian), body, padded to 4 bytes */
    int count = 0;
    size_t at = 0;
    while (at + 14 <= body_len && count < 16) {
        size_t sub = (size_t)(body[at + 12] << 8 | body[at + 13]);
        if (at + 14 + sub > body_len)
            break;
        count += deliver_body(body + at, body + at + 6, body + at + 14, sub, deliver, context);
        at += (14 + sub + 3) & ~(size_t)3;
    }
    return count;
}

void awdl_link_local(const uint8_t mac[6], char *out, size_t size)
{
    snprintf(out, size, "fe80::%02x%02x:%02xff:fe%02x:%02x%02x", mac[0] ^ 0x02, mac[1], mac[2], mac[3], mac[4], mac[5]);
}

int awdl_walk_tlvs(const uint8_t *packet, size_t length, awdl_tlv_visit visit, void *context)
{
    struct awdl_frame f;
    if (!awdl_parse(packet, length, &f))
        return 0;
    int rssi, fcs;
    size_t rt = radiotap(packet, length, &rssi, &fcs);
    const uint8_t *body = packet + rt + 24;
    size_t total = length - rt - (fcs ? 4 : 0) - 24;
    size_t at = 16;
    while (at + 3 <= total) {
        uint16_t len = le16(body + at + 1);
        if (at + 3 + len > total)
            break;
        visit(body[at], body + at + 3, len, context);
        at += 3 + len;
    }
    return 1;
}

static const char *DICTIONARY[] = {
    "", "_airplay._tcp.local", "_airplay._udp.local", "_airplay", "_raop._tcp.local", "_raop._udp.local", "_raop",
    "_airdrop._tcp.local", "_airdrop._udp.local", "_airdrop", "_tcp.local", "_udp.local", "local", "ip6.arpa", "ip4.arpa",
};
#define DICTIONARY_SIZE (sizeof(DICTIONARY) / sizeof(DICTIONARY[0]))

size_t awdl_dns_text(const uint8_t *p, size_t length, char *out, size_t size)
{
    size_t at = 0, written = 0;
    out[0] = 0;
    while (at < length) {
        const char *part;
        char label[64];
        if (p[at] & 0xc0) {
            if (at + 2 > length)
                break;
            unsigned key = (unsigned)(p[at] << 8 | p[at + 1]);
            at += 2;
            part = (key & 0xff) < DICTIONARY_SIZE && (key & 0xff00) == 0xc000 ? DICTIONARY[key & 0xff] : "<?>";
        } else {
            size_t n = p[at++];
            if (n == 0 || at + n > length)
                break;
            snprintf(label, sizeof(label), "%.*s", (int)(n < 63 ? n : 63), (const char *)p + at);
            at += n;
            part = label;
        }
        if (!*part)
            continue;
        written += (size_t)snprintf(out + written, written < size ? size - written : 0, "%s%s", written ? "." : "", part);
        if (written >= size)
            break;
    }
    return at;
}

void awdl_service_text(const uint8_t *v, size_t length, char *out, size_t size)
{
    out[0] = 0;
    if (length < 2)
        return;
    size_t name_len = le16(v);
    if (name_len < 1 || 2 + name_len + 4 > length) {
        snprintf(out, size, "(short)");
        return;
    }
    char name[200], data[300] = "";
    awdl_dns_text(v + 2, name_len - 1, name, sizeof(name));
    uint8_t type = v[2 + name_len - 1];
    size_t data_len = le16(v + 2 + name_len);
    const uint8_t *r = v + 2 + name_len + 4;      /* after the data length and two unknown bytes */
    size_t room = length - (2 + name_len + 4);
    if (data_len > room)
        data_len = room;
    if (type == 12) {
        awdl_dns_text(r, data_len, data, sizeof(data));
        snprintf(out, size, "PTR %s -> %s", name, data);
    } else if (type == 33 && data_len >= 6) {
        awdl_dns_text(r + 6, data_len - 6, data, sizeof(data));
        snprintf(out, size, "SRV %s -> %s port %u", name, data, (unsigned)(r[4] << 8 | r[5]));
    } else if (type == 16) {
        size_t at = 0, w = 0;
        while (at < data_len && w < sizeof(data) - 2) {
            size_t n = r[at++];
            if (at + n > data_len)
                break;
            w += (size_t)snprintf(data + w, sizeof(data) - w, "%s%.*s", w ? " | " : "", (int)n, (const char *)r + at);
            at += n;
        }
        snprintf(out, size, "TXT %s: %s", name, data);
    } else {
        snprintf(out, size, "type %u %s (%zu bytes)", type, name, data_len);
    }
}

size_t awdl_dns_encode(const char *name, uint8_t *out, size_t size)
{
    size_t used = 0;
    const char *at = name;
    while (*at) {
        /* the longest known suffix that matches the rest */
        for (size_t k = 1; k < DICTIONARY_SIZE; k++) {
            if (strcmp(at, DICTIONARY[k]) == 0) {
                if (used + 2 > size)
                    return 0;
                out[used++] = 0xc0;
                out[used++] = (uint8_t)k;
                return used;
            }
        }
        const char *dot = strchr(at, '.');
        size_t n = dot ? (size_t)(dot - at) : strlen(at);
        if (n == 0 || n > 63 || used + 1 + n > size)
            return 0;
        out[used++] = (uint8_t)n;
        memcpy(out + used, at, n);
        used += n;
        at += n + (dot ? 1 : 0);
    }
    return used;
}

const char *awdl_tlv_name(int type)
{
    switch (type) {
    case AWDL_TLV_SSTH_REQUEST: return "ssth-request";
    case AWDL_TLV_SERVICE_REQUEST: return "service-request";
    case AWDL_TLV_SERVICE_RESPONSE: return "service-response";
    case AWDL_TLV_SYNC_PARAMS: return "sync";
    case AWDL_TLV_ELECTION_PARAMS: return "election";
    case AWDL_TLV_SERVICE_PARAMS: return "service";
    case AWDL_TLV_HT_CAPS: return "ht";
    case AWDL_TLV_DATA_PATH_STATE: return "data-path";
    case AWDL_TLV_ARPA: return "arpa";
    case AWDL_TLV_IEEE80211_CONTAINER: return "80211";
    case AWDL_TLV_CHAN_SEQ: return "chanseq";
    case AWDL_TLV_SYNCTREE: return "synctree";
    case AWDL_TLV_VERSION: return "version";
    case AWDL_TLV_BLOOM_FILTER: return "bloom";
    case AWDL_TLV_ELECTION_PARAMS_V2: return "election-v2";
    default: return "?";
    }
}

const char *awdl_devclass_name(int devclass)
{
    switch (devclass) {
    case AWDL_DEV_MACOS: return "Mac";
    case AWDL_DEV_IOS: return "iPhone/iPad";
    case AWDL_DEV_TVOS: return "Apple TV";
    case -1: return "unknown";
    default: return "other Apple device";
    }
}
