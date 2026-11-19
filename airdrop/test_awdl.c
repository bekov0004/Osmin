#include "awdl.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
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
    puts("awdl ok");
    return 0;
}
