/*
 * AWDL (Apple Wireless Direct Link): the radio link AirDrop runs on, as described by the published reverse-engineering
 * work (Stute et al., MobiCom 2018 / USENIX 2019; the AWDL/AirDrop specification of the Owly project).
 *
 * Every AWDL node sends action frames to the broadcast address with a fixed BSSID:
 *   802.11 action frame (category 127, vendor specific), OUI 00:17:f2 (Apple), type 8 (AWDL)
 *   version, subtype (0: periodic synchronization frame PSF, 3: master indication frame MIF), reserved,
 *   PHY transmit time, target transmit time (microseconds), then TLVs: type (1 byte), length (2 bytes, little endian).
 * Data travels in 802.11 data frames with the same BSSID: LLC/SNAP (OUI 00:17:f2, protocol 0x0800), an AWDL data header
 * (0x0403, sequence, padding, ethertype big endian) and the IPv6 packet.
 *
 * Time: a TU is 1024 µs; an availability window (AW) 16 TU; a slot 4 AWs on one channel; a channel sequence 16 slots.
 */
#ifndef OSMIN_AWDL_H
#define OSMIN_AWDL_H

#include <stdint.h>
#include <stddef.h>

#define AWDL_CATEGORY 127
#define AWDL_TYPE 8
#define AWDL_VERSION_1 0x10   /* major 1, minor 0 */
#define AWDL_SUBTYPE_PSF 0
#define AWDL_SUBTYPE_MIF 3

#define AWDL_TU_US 1024
#define AWDL_AW_TU 16
#define AWDL_AWS_PER_SLOT 4
#define AWDL_SLOTS 16
#define AWDL_AF_PERIOD_TU 110

static const uint8_t AWDL_OUI[3] = {0x00, 0x17, 0xf2};
static const uint8_t AWDL_BSSID[6] = {0x00, 0x25, 0x00, 0xff, 0x94, 0x73};
static const uint8_t BROADCAST[6] = {0xff, 0xff, 0xff, 0xff, 0xff, 0xff};

enum awdl_tlv {
    AWDL_TLV_SSTH_REQUEST = 0,
    AWDL_TLV_SERVICE_REQUEST = 1,
    AWDL_TLV_SERVICE_RESPONSE = 2,
    AWDL_TLV_SYNC_PARAMS = 4,
    AWDL_TLV_ELECTION_PARAMS = 5,
    AWDL_TLV_SERVICE_PARAMS = 6,
    AWDL_TLV_HT_CAPS = 7,
    AWDL_TLV_DATA_PATH_STATE = 12,
    AWDL_TLV_ARPA = 16,
    AWDL_TLV_IEEE80211_CONTAINER = 17,
    AWDL_TLV_CHAN_SEQ = 18,
    AWDL_TLV_SYNCTREE = 20,
    AWDL_TLV_VERSION = 21,
    AWDL_TLV_BLOOM_FILTER = 22,
    AWDL_TLV_ELECTION_PARAMS_V2 = 24,
};

/* Device classes in the version TLV. */
enum awdl_devclass { AWDL_DEV_MACOS = 1, AWDL_DEV_IOS = 2, AWDL_DEV_TVOS = 8 };

/* What a received AWDL action frame said. */
struct awdl_frame {
    uint8_t src[6];
    uint8_t subtype;
    uint8_t version;
    uint32_t phy_tx_time;
    uint32_t target_tx_time;
    int rssi;                 /* dBm, 0 when the radio did not say */
    char hostname[64];        /* from the ARPA TLV */
    int devclass;             /* from the version TLV, -1 when absent */
    int awdl_version;         /* the version TLV's version, -1 when absent */
    /* sync parameters (has_sync) */
    int has_sync;
    uint8_t next_aw_channel;
    uint16_t tx_counter;      /* TU to the next AW */
    uint8_t master_channel;
    uint16_t aw_period;
    uint16_t aw_seq;          /* number of that next AW */
    uint8_t sync_master[6];
    /* channel sequence (has_chanseq): the channel of every slot, 0 for none */
    int has_chanseq;
    uint8_t chanseq[AWDL_SLOTS];
    /* election: v2 when present, else v1 */
    int has_election;
    uint8_t master[6];
    uint32_t master_metric;
    uint32_t self_metric;
    uint32_t master_counter;
    uint32_t distance;
    uint8_t tlvs[32];         /* the TLV types seen, in order */
    int n_tlvs;
};

/* What this node says about itself. */
struct awdl_self {
    uint8_t mac[6];
    char hostname[64];
    uint8_t channel;          /* the one channel we serve (single-channel node) */
    uint8_t opclass;          /* its operating class in the channel sequence (0x80: 5 GHz 80 MHz, 0x51: 2.4 GHz) */
    /* timing, filled for every frame */
    uint16_t tx_counter;
    uint16_t aw_seq;
    uint16_t aw_remaining;
    /* election */
    uint8_t master[6];
    uint8_t sync_from[6];
    uint32_t master_metric;
    uint32_t self_metric;
    uint32_t master_counter;
    uint32_t self_counter;
    uint32_t distance;
    /* the AirDrop service (in the MIF as Service Response TLVs), when service[0] */
    char service[32];         /* the instance: 12 hex digits */
    uint16_t service_port;
    char txt[64];             /* e.g. "flags=137" */
};

/* Parses a frame as it comes from a monitor interface (radiotap header first). Returns 1 for an AWDL action frame. */
int awdl_parse(const uint8_t *packet, size_t length, struct awdl_frame *out);

/* Builds a full PSF or MIF of `self` (radiotap header included). Returns its length, 0 when it does not fit. */
size_t awdl_build_action(uint8_t *buffer, size_t size, const struct awdl_self *self, int subtype, uint16_t sequence,
    uint32_t tx_time_us);

/* Kept for the probe: a PSF with only the version and the name. */
size_t awdl_build_psf(uint8_t *buffer, size_t size, const uint8_t mac[6], const char *hostname, uint16_t sequence);

/* Data: an Ethernet frame (dst, src, ethertype, payload) as an AWDL 802.11 data frame (radiotap header included). */
size_t awdl_wrap_data(uint8_t *buffer, size_t size, const uint8_t *ether, size_t length, uint16_t sequence);

/* An AWDL data frame from the monitor interface back as Ethernet frames (an A-MSDU carries several): `deliver` is
 * called for each one. `src` (may be NULL) gets the transmitter. Returns how many were delivered (0: not AWDL data). */
typedef void (*awdl_deliver)(const uint8_t *ether, size_t length, void *context);
int awdl_unwrap_data(const uint8_t *packet, size_t length, uint8_t src[6], awdl_deliver deliver, void *context);

/* The IPv6 link-local address of a MAC (modified EUI-64), written as text. */
void awdl_link_local(const uint8_t mac[6], char *out, size_t size);

/* Every TLV of an AWDL action frame: callback(type, value, length, context). Returns 1 for an AWDL action frame. */
typedef void (*awdl_tlv_visit)(int type, const uint8_t *value, size_t length, void *context);
int awdl_walk_tlvs(const uint8_t *packet, size_t length, awdl_tlv_visit visit, void *context);

/* An AWDL DNS name (labels, and two-byte big-endian keys 0xC0xx of a fixed dictionary) as text; returns bytes used. */
size_t awdl_dns_text(const uint8_t *p, size_t length, char *out, size_t size);

/* A Service Response TLV (2) as text ("PTR name -> target", "SRV name -> target:port", "TXT name: a b"). */
void awdl_service_text(const uint8_t *v, size_t length, char *out, size_t size);

/* Writes a Service Response TLV (header included) for one record; returns its length. */
size_t awdl_service_record(uint8_t *p, const char *name, uint8_t type, const uint8_t *rdata, size_t length);

/* Encodes a name for AWDL: dotted text with the dictionary's known suffixes compressed. Returns the length. */
size_t awdl_dns_encode(const char *name, uint8_t *out, size_t size);

const char *awdl_tlv_name(int type);
const char *awdl_devclass_name(int devclass);

#endif
