/*
 * osmin-awdl: step 1 of AirDrop in Osmin. Finds out whether this computer's Wi-Fi can take part in AWDL, the radio
 * link of AirDrop, while it stays connected to the network ("shared mode": AWDL on the access point's channel).
 *
 *   osmin-awdl doctor                 what the card, its driver and the channel allow (no root needed)
 *   sudo osmin-awdl probe [seconds]   listens for AWDL frames of Apple devices nearby (open the share sheet on the
 *        [--inject] [--channel N]     iPhone, AirDrop set to "Everyone for 10 minutes"); --inject also sends frames.
 *                                     Not connected to any Wi-Fi: the card is free, it listens on channel 149 itself
 *                                     ("exclusive mode", no router needed: AirDrop is a direct link).
 *
 * It adds a monitor interface (osminawdl) beside the normal one for as long as it runs and removes it afterwards.
 * Nothing is changed on the normal connection.
 */
#define _GNU_SOURCE
#include "awdl.h"

#include <arpa/inet.h>
#include <errno.h>
#include <linux/if_packet.h>
#include <net/ethernet.h>
#include <net/if.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define MONITOR "osminawdl"
#define MAX_PEERS 64

static char wifi[IFNAMSIZ];
static char phy[32];
static volatile sig_atomic_t stop;

static void on_signal(int sig) { (void)sig; stop = 1; }

static double now_s(void)
{
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec + t.tv_nsec / 1e9;
}

static int read_line(const char *path, char *out, size_t size)
{
    FILE *f = fopen(path, "r");
    if (!f)
        return 0;
    int ok = fgets(out, (int)size, f) != NULL;
    fclose(f);
    if (ok)
        out[strcspn(out, "\n")] = 0;
    return ok;
}

/* The Wi-Fi interface that is connected (the first wireless one), its phy and driver. */
static int find_wifi(char *driver, size_t driver_size)
{
    FILE *p = popen("ls /sys/class/net", "r");
    if (!p)
        return 0;
    char name[IFNAMSIZ + 8];
    int found = 0;
    while (!found && fgets(name, sizeof(name), p)) {
        name[strcspn(name, "\n")] = 0;
        char path[256];
        snprintf(path, sizeof(path), "/sys/class/net/%s/phy80211/name", name);
        if (strcmp(name, MONITOR) != 0 && read_line(path, phy, sizeof(phy))) {
            snprintf(wifi, sizeof(wifi), "%.15s", name);
            found = 1;
        }
    }
    pclose(p);
    driver[0] = 0;
    if (found) {
        char path[256], link[256];
        snprintf(path, sizeof(path), "/sys/class/net/%s/device/driver", wifi);
        ssize_t n = readlink(path, link, sizeof(link) - 1);
        if (n > 0) {
            link[n] = 0;
            const char *slash = strrchr(link, '/');
            snprintf(driver, driver_size, "%.63s", slash ? slash + 1 : link);
        }
    }
    return found;
}

/* The channel the connected interface is on (0 when not connected). */
static int current_channel(int *width)
{
    char command[128], line[256];
    snprintf(command, sizeof(command), "iw dev %s info 2>/dev/null", wifi);
    FILE *p = popen(command, "r");
    int channel = 0;
    *width = 0;
    if (!p)
        return 0;
    while (fgets(line, sizeof(line), p)) {
        char *at = strstr(line, "channel ");
        if (at)
            sscanf(at, "channel %d", &channel);
        char *w = strstr(line, "width: ");
        if (w)
            sscanf(w, "width: %d", width);
    }
    pclose(p);
    return channel;
}

static int own_mac(uint8_t mac[6])
{
    char path[128], text[32];
    snprintf(path, sizeof(path), "/sys/class/net/%s/address", wifi);
    if (!read_line(path, text, sizeof(text)))
        return 0;
    return sscanf(text, "%hhx:%hhx:%hhx:%hhx:%hhx:%hhx", &mac[0], &mac[1], &mac[2], &mac[3], &mac[4], &mac[5]) == 6;
}

static int run(const char *format, const char *a, const char *b)
{
    char command[256];
    snprintf(command, sizeof(command), format, a, b);
    return system(command);
}

static int doctor(void)
{
    char driver[64];
    if (!find_wifi(driver, sizeof(driver))) {
        printf("no Wi-Fi card found\n");
        return 1;
    }
    int width;
    int channel = current_channel(&width);
    printf("Wi-Fi interface : %s (%s, driver %s)\n", wifi, phy, driver[0] ? driver : "?");
    printf("channel         : %d%s (width %d MHz)\n", channel, channel ? "" : " (not connected)", width);
    int good = channel == 6 || channel == 44 || channel == 149;
    printf("AWDL channel    : %s\n", !channel ? "free: not connected, AWDL can use channel 149 on its own (no router needed)"
        : good ? "yes: AWDL can share it with the connection"
        : "NO while connected: AWDL uses 6, 44 or 149. Either set the router to 149, or disconnect from Wi-Fi (AirDrop needs no router).");
    good = good || !channel;
    char command[160], line[256];
    snprintf(command, sizeof(command), "iw phy %s info 2>/dev/null", phy);
    FILE *p = popen(command, "r");
    int monitor = 0, in_modes = 0;
    while (p && fgets(line, sizeof(line), p)) {
        if (strstr(line, "Supported interface modes"))
            in_modes = 1;
        else if (in_modes && !strstr(line, "* "))
            in_modes = 0;
        else if (in_modes && strstr(line, "* monitor"))
            monitor = 1;
    }
    if (p)
        pclose(p);
    printf("monitor mode    : %s\n", monitor ? "yes" : "NO: the card cannot listen to AWDL");
    printf("root            : %s\n", geteuid() == 0 ? "yes" : "no (probe needs sudo)");
    printf("\nNext: open the share sheet on the iPhone (AirDrop: Everyone for 10 minutes) and run\n  sudo %s probe 30 --inject\n",
        "./osmin-awdl");
    return good && monitor ? 0 : 2;
}

struct peer {
    uint8_t mac[6];
    char hostname[64];
    int devclass;
    int psf, mif;
    int rssi;
    double first, last;
    char tlvs[160];
};

static struct peer peers[MAX_PEERS];
static int n_peers;

static struct peer *peer_for(const uint8_t mac[6], int *fresh)
{
    *fresh = 0;
    for (int i = 0; i < n_peers; i++) {
        if (memcmp(peers[i].mac, mac, 6) == 0)
            return &peers[i];
    }
    if (n_peers == MAX_PEERS)
        return NULL;
    struct peer *p = &peers[n_peers++];
    memset(p, 0, sizeof(*p));
    memcpy(p->mac, mac, 6);
    p->devclass = -1;
    *fresh = 1;
    return p;
}

static void remove_monitor(void)
{
    run("ip link set %s down 2>/dev/null; iw dev %s del 2>/dev/null", MONITOR, MONITOR);
}

static int probe(int seconds, int inject, int want_channel)
{
    char driver[64];
    if (geteuid() != 0) {
        fprintf(stderr, "probe needs root: sudo ./osmin-awdl probe\n");
        return 1;
    }
    if (!find_wifi(driver, sizeof(driver))) {
        fprintf(stderr, "no Wi-Fi card found\n");
        return 1;
    }
    int width;
    int channel = current_channel(&width);
    /* not connected: nothing holds the card on a channel, AWDL gets it alone */
    int exclusive = channel == 0;
    if (exclusive)
        channel = want_channel ? want_channel : 149;
    printf("listening on %s, channel %d%s, %d s%s\n", wifi, channel,
        exclusive ? " (not connected to Wi-Fi: the card is ours)" : " (shared with the Wi-Fi connection)",
        seconds, inject ? ", sending test frames" : "");
    if (!exclusive && want_channel && want_channel != channel)
        printf("note: connected on channel %d, so --channel %d cannot be used (disconnect from Wi-Fi first)\n", channel, want_channel);
    if (channel != 6 && channel != 44 && channel != 149)
        printf("note: channel %d is not an AWDL channel (6, 44, 149): Apple devices will most likely not be heard\n", channel);

    remove_monitor();
    char add[400];
    snprintf(add, sizeof(add), "iw phy %s interface add %s type monitor flags active 2>/dev/null || iw phy %s interface add %s type monitor",
        phy, MONITOR, phy, MONITOR);
    if (system(add) != 0) {
        fprintf(stderr, "could not add a monitor interface beside %s\n", wifi);
        return 1;
    }
    if (run("ip link set %s up%s", MONITOR, "") != 0) {
        fprintf(stderr, "could not bring %s up\n", MONITOR);
        remove_monitor();
        return 1;
    }
    if (exclusive) {
        char number[16];
        snprintf(number, sizeof(number), "%d", channel);
        if (run("iw dev %s set channel %s", MONITOR, number) != 0)
            printf("note: could not tune to channel %d (is NetworkManager scanning? try: nmcli radio wifi on, no network)\n", channel);
    }

    int fd = socket(AF_PACKET, SOCK_RAW, htons(ETH_P_ALL));
    if (fd < 0) {
        perror("socket");
        remove_monitor();
        return 1;
    }
    struct sockaddr_ll where = {.sll_family = AF_PACKET, .sll_protocol = htons(ETH_P_ALL), .sll_ifindex = (int)if_nametoindex(MONITOR)};
    if (bind(fd, (struct sockaddr *)&where, sizeof(where)) < 0) {
        perror("bind");
        close(fd);
        remove_monitor();
        return 1;
    }

    uint8_t mac[6] = {0};
    own_mac(mac);
    char host[64];
    gethostname(host, sizeof(host));
    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);

    double start = now_s(), next_send = start;
    long frames = 0, awdl = 0, sent = 0, send_errors = 0, echoes = 0;
    int last_errno = 0;
    uint16_t sequence = 0;
    uint8_t buffer[4096];
    while (!stop && now_s() - start < seconds) {
        if (inject && now_s() >= next_send) {
            uint8_t frame[512];
            size_t length = awdl_build_psf(frame, sizeof(frame), mac, host, sequence++);
            if (send(fd, frame, length, 0) == (ssize_t)length)
                sent++;
            else {
                send_errors++;
                last_errno = errno;
            }
            next_send += 0.110;
        }
        struct pollfd pfd = {.fd = fd, .events = POLLIN};
        if (poll(&pfd, 1, 20) <= 0)
            continue;
        ssize_t n = recv(fd, buffer, sizeof(buffer), 0);
        if (n <= 0)
            continue;
        frames++;
        struct awdl_frame f;
        if (!awdl_parse(buffer, (size_t)n, &f))
            continue;
        if (memcmp(f.src, mac, 6) == 0) {
            echoes++;
            continue;
        }
        awdl++;
        int fresh;
        struct peer *p = peer_for(f.src, &fresh);
        if (!p)
            continue;
        p->last = now_s() - start;
        if (fresh)
            p->first = p->last;
        if (f.subtype == AWDL_SUBTYPE_PSF)
            p->psf++;
        else if (f.subtype == AWDL_SUBTYPE_MIF)
            p->mif++;
        if (f.rssi)
            p->rssi = f.rssi;
        if (f.hostname[0])
            snprintf(p->hostname, sizeof(p->hostname), "%s", f.hostname);
        if (f.devclass >= 0)
            p->devclass = f.devclass;
        if (f.subtype == AWDL_SUBTYPE_MIF || !p->tlvs[0]) {
            p->tlvs[0] = 0;
            for (int i = 0; i < f.n_tlvs; i++) {
                size_t used = strlen(p->tlvs);
                snprintf(p->tlvs + used, sizeof(p->tlvs) - used, "%s%s", i ? "," : "", awdl_tlv_name(f.tlvs[i]));
            }
        }
        if (fresh)
            printf("[%5.1fs] AWDL device %02x:%02x:%02x:%02x:%02x:%02x %s (%s) %d dBm\n", p->last,
                f.src[0], f.src[1], f.src[2], f.src[3], f.src[4], f.src[5],
                p->hostname[0] ? p->hostname : "", awdl_devclass_name(p->devclass), p->rssi);
        fflush(stdout);
    }
    close(fd);
    remove_monitor();

    printf("\n--- result ---\n");
    printf("frames heard        : %ld (all kinds)\n", frames);
    printf("AWDL frames         : %ld from %d device(s)\n", awdl, n_peers);
    for (int i = 0; i < n_peers; i++) {
        struct peer *p = &peers[i];
        printf("  %02x:%02x:%02x:%02x:%02x:%02x  %-24s %-12s PSF %d MIF %d  %d dBm  seen %.1f-%.1fs\n    TLVs: %s\n",
            p->mac[0], p->mac[1], p->mac[2], p->mac[3], p->mac[4], p->mac[5],
            p->hostname[0] ? p->hostname : "(no name)", awdl_devclass_name(p->devclass), p->psf, p->mif, p->rssi,
            p->first, p->last, p->tlvs);
    }
    if (inject)
        printf("test frames sent    : %ld ok, %ld failed%s%s%s; heard back %ld\n", sent, send_errors,
            send_errors ? " (last error: " : "", send_errors ? strerror(last_errno) : "", send_errors ? ")" : "", echoes);
    printf("verdict             : %s\n",
        frames == 0 ? "the monitor interface heard nothing at all: the driver does not deliver frames in this mode"
        : awdl == 0 ? "no AWDL heard: is the share sheet open on the iPhone, AirDrop on Everyone, and the router on 6/44/149?"
        : inject && sent == 0 ? "AWDL heard, but frames cannot be sent: receiving might work, sending will not"
        : "AWDL heard" );
    return 0;
}

int main(int argc, char **argv)
{
    if (argc >= 2 && strcmp(argv[1], "doctor") == 0)
        return doctor();
    if (argc >= 2 && strcmp(argv[1], "probe") == 0) {
        int seconds = 30, inject = 0, channel = 0;
        for (int i = 2; i < argc; i++) {
            if (strcmp(argv[i], "--inject") == 0)
                inject = 1;
            else if (strcmp(argv[i], "--channel") == 0 && i + 1 < argc)
                channel = atoi(argv[++i]);
            else if (atoi(argv[i]) > 0)
                seconds = atoi(argv[i]);
        }
        return probe(seconds, inject, channel);
    }
    fprintf(stderr, "usage: osmin-awdl doctor | probe [seconds] [--inject]\n");
    return 1;
}
