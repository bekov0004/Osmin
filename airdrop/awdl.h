/*
 * AWDL (Apple Wireless Direct Link): the radio link AirDrop runs on. What the frames look like, as described in
 * "One Billion Apples' Secret Sauce" (Stute et al., MobiSys 2018) and the open implementations that followed it.
 *
 * Every AWDL node sends action frames to the broadcast address with a fixed BSSID:
 *   802.11 action frame (category 127, vendor specific), OUI 00:17:f2 (Apple), type 8 (AWDL)
 *   version, subtype (0: periodic synchronization frame PSF, 3: master indication frame MIF), reserved,
 *   PHY transmit time, target transmit time (microseconds), then TLVs: type (1 byte), length (2 bytes, little endian).
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

/* What a received AWDL frame said. */
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
    int master_metric;        /* election parameters, -1 when absent */
    uint8_t master[6];
    int has_master;
    uint8_t tlvs[32];         /* the TLV types seen, in order */
    int n_tlvs;
};

/* Parses a frame as it comes from a monitor interface (radiotap header first). Returns 1 for an AWDL frame. */
int awdl_parse(const uint8_t *packet, size_t length, struct awdl_frame *out);

/* Builds a minimal PSF from `mac` (radiotap header included). Returns its length. */
size_t awdl_build_psf(uint8_t *buffer, size_t size, const uint8_t mac[6], const char *hostname, uint16_t sequence);

const char *awdl_tlv_name(int type);
const char *awdl_devclass_name(int devclass);

#endif
