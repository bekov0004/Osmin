#include "awdl.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static int got;
static uint8_t last[2400];
static size_t last_len;
static void take(const uint8_t *e, size_t n, void *c) { (void)c; got++; memcpy(last, e, n); last_len = n; }

static void test_full(void)
{
    struct awdl_self me;
    memset(&me, 0, sizeof me);
    uint8_t mac[6] = {0xac, 0x50, 0xde, 0xcf, 0xcd, 0xc9}, master[6] = {0x62, 0x87, 0x64, 0x09, 0x6e, 0x30};
    memcpy(me.mac, mac, 6);
    strcpy(me.hostname, "ProBook");
    me.channel = 149;
    me.opclass = 0x80;
    me.tx_counter = 7;
    me.aw_seq = 1234;
    memcpy(me.master, master, 6);
    memcpy(me.sync_from, master, 6);
    me.master_metric = 520;
    me.self_metric = 60;
    me.distance = 1;
    uint8_t frame[1024];
    size_t n = awdl_build_action(frame, sizeof frame, &me, AWDL_SUBTYPE_MIF, 3, 99);
    assert(n > 100);
    struct awdl_frame f;
    assert(awdl_parse(frame, n, &f) == 1);
    assert(f.subtype == AWDL_SUBTYPE_MIF);
    assert(strcmp(f.hostname, "ProBook") == 0);
    assert(f.has_sync && f.tx_counter == 7 && f.aw_seq == 1234 && f.next_aw_channel == 149 && f.aw_period == 16);
    assert(memcmp(f.sync_master, master, 6) == 0);
    assert(f.has_chanseq);
    for (int i = 0; i < AWDL_SLOTS; i++)
        assert(f.chanseq[i] == 149);
    assert(f.has_election && memcmp(f.master, master, 6) == 0 && f.master_metric == 520 && f.self_metric == 60 && f.distance == 1);
    assert(f.devclass == AWDL_DEV_MACOS);
    /* the order of the TLVs, as an iPhone sends them: 4 5 18 24 12 7 16 21 6 */
    const uint8_t order[] = {4, 5, 18, 24, 12, 7, 16, 21, 6};
    assert(f.n_tlvs == 9);
    assert(memcmp(f.tlvs, order, 9) == 0);
    /* a PSF has no ARPA */
    n = awdl_build_action(frame, sizeof frame, &me, AWDL_SUBTYPE_PSF, 4, 99);
    assert(awdl_parse(frame, n, &f) == 1 && f.n_tlvs == 8 && f.hostname[0] == 0);
}

static void test_data(void)
{
    uint8_t ether[200], frame[400];
    uint8_t dst[6] = {0x62, 0x87, 0x64, 0x09, 0x6e, 0x30}, src[6] = {0xac, 0x50, 0xde, 0xcf, 0xcd, 0xc9}, who[6];
    memcpy(ether, dst, 6);
    memcpy(ether + 6, src, 6);
    ether[12] = 0x86;
    ether[13] = 0xdd;
    for (int i = 14; i < 114; i++)
        ether[i] = (uint8_t)i;
    size_t n = awdl_wrap_data(frame, sizeof frame, ether, 114, 9);
    assert(n == 8 + 24 + 8 + 8 + 100);
    assert(frame[8] == 0x08 && memcmp(frame + 8 + 16, AWDL_BSSID, 6) == 0);
    got = 0;
    assert(awdl_unwrap_data(frame, n, who, take, NULL) == 1 && got == 1);
    assert(last_len == 114 && memcmp(last, ether, 114) == 0 && memcmp(who, src, 6) == 0);
    /* a QoS A-MSDU with two subframes */
    uint8_t q[600];
    size_t at = 0;
    memset(q, 0, sizeof q);
    q[2] = 8;
    at = 8;
    q[at] = 0x88;
    memcpy(q + at + 4, dst, 6);
    memcpy(q + at + 10, src, 6);
    memcpy(q + at + 16, AWDL_BSSID, 6);
    q[at + 24] = 0x80;                 /* QoS control: A-MSDU present */
    at += 26;
    for (int k = 0; k < 2; k++) {
        size_t body = n - 8 - 24;     /* SNAP + AWDL header + payload */
        memcpy(q + at, dst, 6);
        memcpy(q + at + 6, src, 6);
        q[at + 12] = (uint8_t)(body >> 8);
        q[at + 13] = (uint8_t)body;
        memcpy(q + at + 14, frame + 8 + 24, body);
        at += (14 + body + 3) & ~(size_t)3;
    }
    got = 0;
    assert(awdl_unwrap_data(q, at, who, take, NULL) == 2 && got == 2 && last_len == 114);
    /* an action frame is not data */
    assert(awdl_unwrap_data(frame + 0, 8 + 24, who, take, NULL) == 0);
    char ll[64];
    awdl_link_local(src, ll, sizeof ll);
    assert(strcmp(ll, "fe80::ae50:deff:fecf:cdc9") == 0);
}

static void test_dns(void)
{
    uint8_t b[128];
    char t[200];
    size_t n = awdl_dns_encode("_airdrop._tcp.local", b, sizeof b);
    assert(n == 2 && b[0] == 0xc0 && b[1] == 0x07);
    n = awdl_dns_encode("a1b2c3d4e5f6._airdrop._tcp.local", b, sizeof b);
    assert(n == 15 && b[0] == 12 && b[13] == 0xc0 && b[14] == 0x07);
    awdl_dns_text(b, n, t, sizeof t);
    assert(strcmp(t, "a1b2c3d4e5f6._airdrop._tcp.local") == 0);
    n = awdl_dns_encode("ProBook.local", b, sizeof b);
    assert(n == 10 && b[8] == 0xc0 && b[9] == 0x0c);
    /* our MIF with the service records: they read back */
    struct awdl_self me;
    memset(&me, 0, sizeof me);
    strcpy(me.hostname, "ProBook");
    me.channel = 149;
    me.opclass = 0x80;
    strcpy(me.service, "a1b2c3d4e5f6");
    me.service_port = 8771;
    strcpy(me.txt, "flags=137");
    uint8_t frame[1500];
    size_t len = awdl_build_action(frame, sizeof frame, &me, AWDL_SUBTYPE_MIF, 1, 0);
    struct awdl_frame f;
    assert(awdl_parse(frame, len, &f) == 1 && f.n_tlvs == 12);
    /* the CRC-8 values an iPhone put in its Service Parameters for its own services */
    assert(awdl_name_crc("_applicationservicepairing._tcp.local") == 32);
    assert(awdl_name_crc("_appsvcprepair._tcp.local") == 45);
    assert(awdl_name_crc("_airdrop._tcp.local") == 158);
    uint8_t rec[300];
    size_t r = awdl_service_record(rec, "a1b2c3d4e5f6._airdrop._tcp.local", 33, (const uint8_t[]){0, 0, 0, 0, 0x22, 0x43, 7, 'P', 'r', 'o', 'B', 'o', 'o', 'k', 0xc0, 0x0c}, 16);
    awdl_service_text(rec + 3, r - 3, t, sizeof t);
    assert(strcmp(t, "SRV a1b2c3d4e5f6._airdrop._tcp.local -> ProBook.local port 8771") == 0);
}

int main(void)
{
    uint8_t mac[6] = {0xac, 0x50, 0xde, 0xcf, 0xcd, 0xc9}, frame[512];
    size_t n = awdl_build_psf(frame, sizeof frame, mac, "osmin-laptop", 7);
    struct awdl_frame f;
    assert(awdl_parse(frame, n, &f) == 1);
    assert(memcmp(f.src, mac, 6) == 0);
    assert(f.subtype == AWDL_SUBTYPE_PSF);
    assert(strcmp(f.hostname, "osmin-laptop") == 0);
    assert(f.devclass == AWDL_DEV_MACOS && f.awdl_version == 0x34);
    assert(f.n_tlvs == 2);
    /* radiotap with TSFT + flags (FCS) + rate + channel + signal, and a trailing FCS */
    uint8_t rt[64] = {0, 0, 0, 0, 0x2f, 0, 0, 0};       /* present: TSFT, FLAGS, RATE, CHANNEL, DBM_ANTSIGNAL */
    size_t h = 8 + 8 + 1 + 1 + 4 + 1;                    /* 8 aligned TSFT, flags, rate, channel(2-aligned at 18), signal */
    rt[2] = (uint8_t)h;
    rt[16] = 0x10;                                       /* flags: FCS at end */
    rt[22] = (uint8_t)-61;                               /* signal */
    uint8_t big[700];
    memcpy(big, rt, h);
    memcpy(big + h, frame + 8, n - 8);
    memset(big + h + n - 8, 0xee, 4);
    assert(awdl_parse(big, h + n - 8 + 4, &f) == 1);
    assert(f.rssi == -61);
    assert(strcmp(f.hostname, "osmin-laptop") == 0);
    /* not AWDL */
    big[h + 24] = 4;
    assert(awdl_parse(big, h + n - 8 + 4, &f) == 0);
    test_full();
    test_data();
    test_dns();
    puts("awdl ok");
    return 0;
}
