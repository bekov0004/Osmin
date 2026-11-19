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
    /* the order of the TLVs: 4 5 18 24 6 7 16 12 21 */
    const uint8_t order[] = {4, 5, 18, 24, 6, 7, 16, 12, 21};
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
    puts("awdl ok");
    return 0;
}
