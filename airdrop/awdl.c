#include "awdl.h"

#include <stdio.h>
#include <string.h>

static uint16_t le16(const uint8_t *p) { return (uint16_t)(p[0] | p[1] << 8); }
static uint32_t le32(const uint8_t *p) { return (uint32_t)(p[0] | p[1] << 8 | p[2] << 16 | (uint32_t)p[3] << 24); }
static void put16(uint8_t *p, uint16_t v) { p[0] = v & 0xff; p[1] = v >> 8; }
static void put32(uint8_t *p, uint32_t v) { p[0] = v & 0xff; p[1] = v >> 8 & 0xff; p[2] = v >> 16 & 0xff; p[3] = v >> 24; }

/* Radiotap: walks the present fields up to the signal strength; sets *fcs when the frame still ends with its FCS. */
static size_t radiotap(const uint8_t *p, size_t length, int *rssi, int *fcs)
{
    *rssi = 0;
    *fcs = 0;
    if (length < 8 || p[0] != 0)
        return 0;
    size_t header = le16(p + 2);
    if (header > length)
        return 0;
    /* the present words (bit 31: another word follows) */
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
    /* fields in bit order: (bit, size, alignment) */
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

int awdl_parse(const uint8_t *packet, size_t length, struct awdl_frame *out)
{
    int rssi, fcs;
    size_t rt = radiotap(packet, length, &rssi, &fcs);
    if (!rt)
        return 0;
    const uint8_t *f = packet + rt;
    size_t n = length - rt - (fcs ? 4 : 0);
    /* management (type 0), action (subtype 13): frame control 0xd0 */
    if (n < 24 + 16 || (f[0] & 0xfc) != 0xd0)
        return 0;
    const uint8_t *body = f + 24;
    if (body[0] != AWDL_CATEGORY || memcmp(body + 1, AWDL_OUI, 3) != 0 || body[4] != AWDL_TYPE)
        return 0;
    memset(out, 0, sizeof(*out));
    out->devclass = -1;
    out->awdl_version = -1;
    out->master_metric = -1;
    out->rssi = rssi;
    memcpy(out->src, f + 10, 6);
    out->version = body[5];
    out->subtype = body[6];
    out->phy_tx_time = le32(body + 8);
    out->target_tx_time = le32(body + 12);

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
        if (type == AWDL_TLV_ARPA && len > 1)
            dns_name(v + 1, len - 1, out->hostname, sizeof(out->hostname));
        else if (type == AWDL_TLV_VERSION && len >= 2) {
            out->awdl_version = v[0];
            out->devclass = v[1];
        } else if (type == AWDL_TLV_ELECTION_PARAMS && len >= 15) {
            memcpy(out->master, v + 5, 6);
            out->has_master = 1;
            out->master_metric = (int)le32(v + 11);
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

size_t awdl_build_psf(uint8_t *buffer, size_t size, const uint8_t mac[6], const char *hostname, uint16_t sequence)
{
    if (size < 256)
        return 0;
    uint8_t *p = buffer;
    /* radiotap: version 0, no fields */
    memset(p, 0, 8);
    p[2] = 8;
    p += 8;
    /* 802.11 action frame to everyone in the AWDL BSS */
    p[0] = 0xd0;
    p[1] = 0;
    put16(p + 2, 0);
    memcpy(p + 4, BROADCAST, 6);
    memcpy(p + 10, mac, 6);
    memcpy(p + 16, AWDL_BSSID, 6);
    put16(p + 22, (uint16_t)(sequence << 4));
    p += 24;
    /* AWDL header */
    p[0] = AWDL_CATEGORY;
    memcpy(p + 1, AWDL_OUI, 3);
    p[4] = AWDL_TYPE;
    p[5] = AWDL_VERSION_1;
    p[6] = AWDL_SUBTYPE_PSF;
    p[7] = 0;
    put32(p + 8, 0);
    put32(p + 12, 0);
    p += 16;
    /* version: AWDL 3.4 (0x34), a Mac */
    const uint8_t version[2] = {0x34, AWDL_DEV_MACOS};
    p += tlv(p, AWDL_TLV_VERSION, version, sizeof(version));
    /* ARPA: flags, the host name as one DNS label, then a pointer to ".local" */
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
