/*
 * osmin-awdld: an AWDL node for AirDrop in Osmin. Needs root (a monitor interface and a TAP interface).
 *
 *   sudo osmin-awdld [--channel 149|44|6] [--take-card] [--name NAME] [--verbose]
 *
 * Connected to Wi-Fi it shares the access point's channel (which must then be 6, 44 or 149); not connected, it tunes
 * the card to --channel (149 by default). --take-card takes the whole card: it turns the radio on if it was off,
 * leaves the network it is on, tells NetworkManager to keep off the card while it runs (no scanning, no reconnecting),
 * and afterwards gives it back and joins that network again.
 *
 * What it does:
 *  - adds a monitor interface (osminawdl) beside the Wi-Fi one, and a TAP interface awdl0 with the Wi-Fi card's MAC
 *    (the card acknowledges frames sent to its own address), which gets its IPv6 link-local address from it;
 *  - follows the AWDL schedule of the Apple devices nearby (their sync parameters) and, in the windows where they are
 *    on our channel, sends our PSF/MIF and the data waiting for them; with nobody to follow it announces itself in
 *    bursts so that they notice it;
 *  - Apple devices that sent a MIF and a version become neighbours: awdl0 gets a fixed IPv6 neighbour entry for them,
 *    so the AirDrop server (airdrop.py) can talk to them over plain IPv6.
 * Every few seconds it writes what it hears and sends, for testing.
 */
#define _GNU_SOURCE
#include "awdl.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/if_packet.h>
#include <linux/if_tun.h>
#include <net/ethernet.h>
#include <net/if.h>
#include <poll.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define MONITOR "osminawdl"
#define TAP "awdl0"
#define MAX_PEERS 32
#define QUEUE 512
#define PEER_TIMEOUT_US 5000000LL
#define GUARD_US (3 * AWDL_TU_US)
#define AW_US ((int64_t)AWDL_AW_TU * AWDL_TU_US)

static char wifi[IFNAMSIZ];
static char phy[32];
static int verbose;
static int took_card;
static char saved_connection[256];
static char self_service[32], self_txt[64];
static int self_port = 8771;
static volatile sig_atomic_t stop;

static void on_signal(int sig) { (void)sig; stop = 1; }

static int64_t now_us(void)
{
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return (int64_t)t.tv_sec * 1000000 + t.tv_nsec / 1000;
}

static void say(const char *format, ...)
{
    struct timespec t;
    clock_gettime(CLOCK_REALTIME, &t);
    struct tm tm;
    localtime_r(&t.tv_sec, &tm);
    printf("%02d:%02d:%02d.%03ld ", tm.tm_hour, tm.tm_min, tm.tm_sec, t.tv_nsec / 1000000);
    va_list args;
    va_start(args, format);
    vprintf(format, args);
    va_end(args);
    putchar('\n');
    fflush(stdout);
}

static FILE *capture;
static long rx_echo;

/* A pcap file of every AWDL frame heard (ours come back on the monitor interface too), radiotap link type. */
static void capture_open(const char *path)
{
    capture = fopen(path, "wb");
    if (!capture) {
        perror(path);
        return;
    }
    uint32_t header[6] = {0xa1b2c3d4, 0x00040002, 0, 0, 65535, 127};
    fwrite(header, sizeof(header), 1, capture);
    say("capturing to %s", path);
}

static void capture_write(const uint8_t *packet, size_t length)
{
    if (!capture)
        return;
    struct timespec t;
    clock_gettime(CLOCK_REALTIME, &t);
    uint32_t record[4] = {(uint32_t)t.tv_sec, (uint32_t)(t.tv_nsec / 1000), (uint32_t)length, (uint32_t)length};
    fwrite(record, sizeof(record), 1, capture);
    fwrite(packet, length, 1, capture);
    fflush(capture);
}

static int sh(const char *format, ...)
{
    char command[512];
    va_list args;
    va_start(args, format);
    vsnprintf(command, sizeof(command), format, args);
    va_end(args);
    if (verbose)
        say("$ %s", command);
    return system(command);
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

static int find_wifi(void)
{
    FILE *p = popen("ls /sys/class/net", "r");
    char name[64];
    int found = 0;
    while (p && !found && fgets(name, sizeof(name), p)) {
        name[strcspn(name, "\n")] = 0;
        char path[256];
        snprintf(path, sizeof(path), "/sys/class/net/%.40s/phy80211/name", name);
        if (strcmp(name, MONITOR) != 0 && read_line(path, phy, sizeof(phy))) {
            snprintf(wifi, sizeof(wifi), "%.15s", name);
            found = 1;
        }
    }
    if (p)
        pclose(p);
    return found;
}

static int current_channel(void)
{
    char command[128], line[256];
    snprintf(command, sizeof(command), "iw dev %s info 2>/dev/null", wifi);
    FILE *p = popen(command, "r");
    int channel = 0;
    while (p && fgets(line, sizeof(line), p)) {
        char *at = strstr(line, "channel ");
        if (at)
            sscanf(at, "channel %d", &channel);
    }
    if (p)
        pclose(p);
    return channel;
}

static int read_mac(const char *ifname, uint8_t mac[6])
{
    char path[128], text[32];
    snprintf(path, sizeof(path), "/sys/class/net/%s/address", ifname);
    return read_line(path, text, sizeof(text)) &&
        sscanf(text, "%hhx:%hhx:%hhx:%hhx:%hhx:%hhx", &mac[0], &mac[1], &mac[2], &mac[3], &mac[4], &mac[5]) == 6;
}

static const char *mac_text(const uint8_t m[6])
{
    static char buffers[4][18];
    static int next;
    char *b = buffers[next++ & 3];
    snprintf(b, 18, "%02x:%02x:%02x:%02x:%02x:%02x", m[0], m[1], m[2], m[3], m[4], m[5]);
    return b;
}

/* --- peers -------------------------------------------------------------------------------------------------- */

struct frame { uint8_t data[2400]; size_t length; };

struct peer {
    uint8_t mac[6];
    char hostname[64];
    int devclass;
    int seen_mif, valid;
    int64_t heard;            /* last time anything came from it */
    uint8_t chanseq[AWDL_SLOTS];
    int has_chanseq;
    /* its schedule: AW number `seq` started at `start` */
    int has_sync;
    int64_t sync_start;
    uint16_t sync_seq;
    uint8_t master[6];
    uint32_t master_metric, master_counter, distance;
    /* data waiting for its next window on our channel */
    struct frame *queue[QUEUE];
    int queued;
    long rx_frames, rx_data, tx_data;
    uint16_t last_seqctl;
    int has_last_seqctl;
};

static struct peer peers[MAX_PEERS];
static int n_peers;
static struct frame *multicast[QUEUE];
static int n_multicast;

static struct awdl_self self;
static int monitor_fd = -1, tap_fd = -1;
static uint16_t sequence;
static long sent_af, sent_data, send_errors, rx_af, rx_data, tap_in, rx_dup;

static struct peer *find_peer(const uint8_t mac[6])
{
    for (int i = 0; i < n_peers; i++) {
        if (memcmp(peers[i].mac, mac, 6) == 0)
            return &peers[i];
    }
    return NULL;
}

static struct peer *add_peer(const uint8_t mac[6])
{
    struct peer *p = find_peer(mac);
    if (p || n_peers == MAX_PEERS)
        return p;
    p = &peers[n_peers++];
    memset(p, 0, sizeof(*p));
    memcpy(p->mac, mac, 6);
    p->devclass = -1;
    return p;
}

static void neighbour(const struct peer *p, int add)
{
    char ll[64];
    awdl_link_local(p->mac, ll, sizeof(ll));
    if (add)
        sh("ip -6 neigh replace %s lladdr %s dev %s nud permanent 2>/dev/null", ll, mac_text(p->mac), TAP);
    else
        sh("ip -6 neigh del %s dev %s 2>/dev/null", ll, TAP);
}

static void drop_queue(struct frame **queue, int *count)
{
    for (int i = 0; i < *count; i++)
        free(queue[i]);
    *count = 0;
}

static void forget_peer(int index)
{
    struct peer *p = &peers[index];
    if (p->valid) {
        neighbour(p, 0);
        say("gone: %s %s", mac_text(p->mac), p->hostname);
    }
    drop_queue(p->queue, &p->queued);
    peers[index] = peers[--n_peers];
}

/* --- schedule ----------------------------------------------------------------------------------------------- */

/* Our clock of AWs: AW number `seq` starts at `start` (µs); everything else follows from AW_US. */
static int64_t clock_start;
static uint16_t clock_seq;
static uint8_t sync_source[6];
static int synced;

/* The AW we are in at `t`: its number and when it started. */
static void aw_at(int64_t t, uint16_t *seq, int64_t *start)
{
    int64_t delta = t - clock_start;
    int64_t index = delta >= 0 ? delta / AW_US : -((-delta + AW_US - 1) / AW_US);
    *seq = (uint16_t)(clock_seq + index);
    *start = clock_start + index * AW_US;
}

/* The slot of the channel sequence that AW `seq` is in. Worked out from captures of iPhones (where their frames fall
 * against their announced AW numbers): slot 0 starts 4 AWs before an AW number divisible by 64, i.e. slots run
 * one slot ahead of seq / 4. */
static int slot_of(uint16_t seq)
{
    return (int)(((unsigned)seq + AWDL_AWS_PER_SLOT) / AWDL_AWS_PER_SLOT % AWDL_SLOTS);
}

/* Whether a peer listens on our channel in AW `seq`: its channel there, or an empty slot right after one of ours (the
 * captures show iPhones staying on through such a slot). */
static int peer_here(const struct peer *p, uint16_t seq)
{
    if (!p->has_chanseq)
        return 1;
    int slot = slot_of(seq);
    if (p->chanseq[slot] == self.channel)
        return 1;
    return p->chanseq[slot] == 0 && p->chanseq[(slot + AWDL_SLOTS - 1) % AWDL_SLOTS] == self.channel;
}

/* Follows the best master we hear: the one with the highest metric (then counter) among valid peers. */
static void elect(void)
{
    struct peer *best = NULL;
    for (int i = 0; i < n_peers; i++) {
        struct peer *p = &peers[i];
        if (!p->valid || !p->has_sync)
            continue;
        if (!best || p->master_metric > best->master_metric ||
            (p->master_metric == best->master_metric && p->master_counter > best->master_counter) ||
            (p->master_metric == best->master_metric && p->master_counter == best->master_counter && p->distance < best->distance))
            best = p;
    }
    if (!best) {
        if (synced)
            say("no Apple device to follow: announcing ourselves");
        synced = 0;
        memcpy(self.master, self.mac, 6);
        memcpy(self.sync_from, self.mac, 6);
        self.master_metric = self.self_metric;
        self.master_counter = self.self_counter;
        self.distance = 0;
        return;
    }
    if (!synced || memcmp(sync_source, best->mac, 6) != 0)
        say("following %s %s (master %s, metric %u)", mac_text(best->mac), best->hostname, mac_text(best->master), best->master_metric);
    synced = 1;
    memcpy(sync_source, best->mac, 6);
    clock_start = best->sync_start;
    clock_seq = best->sync_seq;
    memcpy(self.master, best->master, 6);
    memcpy(self.sync_from, best->mac, 6);
    self.master_metric = best->master_metric;
    self.master_counter = best->master_counter;
    self.distance = best->distance + 1;
}

/* --- sending ------------------------------------------------------------------------------------------------ */

/* The card's queue: frames handed to it that have not come back (as transmitted) on the monitor interface yet. The
 * card sends only some 30-40 injected frames a second; give it more and everything waits behind (seen: data frames
 * out on the air 28 s late). */
static long handed, echoed, lost;
static int64_t last_echo;

static long backlog(void)
{
    long waiting = handed - echoed - lost;
    /* frames that never come back (dropped by the driver) must not stop us for ever */
    if (waiting > 0 && now_us() - last_echo > 500000) {
        lost += waiting;
        waiting = 0;
    }
    return waiting;
}

static void send_raw(const uint8_t *frame, size_t length, long *counter)
{
    /* never block: a full queue would freeze everything (seen: 8 s) */
    if (send(monitor_fd, frame, length, MSG_DONTWAIT) == (ssize_t)length) {
        (*counter)++;
        if (handed == echoed + lost)
            last_echo = now_us();
        handed++;
    } else {
        send_errors++;
        if (verbose)
            say("send failed: %s", strerror(errno));
    }
}

static void send_action(int subtype)
{
    int64_t t = now_us();
    uint16_t seq;
    int64_t start;
    aw_at(t, &seq, &start);
    /* the next slot boundary: AWs counted from our anchor in fours */
    int64_t slot = (int64_t)AWDL_AWS_PER_SLOT * AW_US;
    int64_t since = t - clock_start;
    int64_t into = ((since % slot) + slot) % slot;
    int64_t next = t + (slot - into);
    self.tx_counter = (uint16_t)((next - t) / AWDL_TU_US);
    self.aw_seq = (uint16_t)(clock_seq + (since - into + slot) / AW_US);
    self.aw_remaining = (uint16_t)((start + AW_US - t) / AWDL_TU_US);
    uint8_t frame[1500];
    size_t length = awdl_build_action(frame, sizeof(frame), &self, subtype, sequence++, (uint32_t)t);
    if (length)
        send_raw(frame, length, &sent_af);
}

/* When each data frame (by its 802.11 sequence number) was handed to the card: the echo then says how long it took
 * to go out. */
static int64_t sent_at[4096];
static int64_t latency_sum, latency_max;
static long latency_count;

static void send_ether(const uint8_t *ether, size_t length)
{
    uint8_t frame[2600];
    uint16_t seq = sequence++;
    size_t n = awdl_wrap_data(frame, sizeof(frame), ether, length, seq);
    if (!n)
        return;
    sent_at[seq & 4095] = now_us();
    send_raw(frame, n, &sent_data);
}

static void enqueue(struct frame **queue, int *count, const uint8_t *data, size_t length)
{
    if (length > sizeof(queue[0]->data))
        return;
    if (*count == QUEUE) {
        free(queue[0]);
        memmove(queue, queue + 1, sizeof(queue[0]) * (QUEUE - 1));
        (*count)--;
    }
    struct frame *f = malloc(sizeof(*f));
    if (!f)
        return;
    memcpy(f->data, data, length);
    f->length = length;
    queue[(*count)++] = f;
}

/* In an AW where `p` is on our channel: what waits for it goes now. */
static void flush_peer(struct peer *p)
{
    int sent = 0;
    while (sent < p->queued && backlog() < 24) {
        send_ether(p->queue[sent]->data, p->queue[sent]->length);
        p->tx_data++;
        sent++;
    }
    for (int i = 0; i < sent; i++)
        free(p->queue[i]);
    memmove(p->queue, p->queue + sent, sizeof(p->queue[0]) * (size_t)(p->queued - sent));
    p->queued -= sent;
}

/* --- receiving ---------------------------------------------------------------------------------------------- */

static void on_action(const struct awdl_frame *f, int64_t t)
{
    rx_af++;
    if (memcmp(f->src, self.mac, 6) == 0)
        return;
    struct peer *p = add_peer(f->src);
    if (!p)
        return;
    p->heard = t;
    p->rx_frames++;
    if (f->hostname[0])
        snprintf(p->hostname, sizeof(p->hostname), "%s", f->hostname);
    if (f->devclass >= 0)
        p->devclass = f->devclass;
    if (f->subtype == AWDL_SUBTYPE_MIF)
        p->seen_mif = 1;
    if (f->has_chanseq) {
        memcpy(p->chanseq, f->chanseq, AWDL_SLOTS);
        p->has_chanseq = 1;
    }
    if (f->has_sync && f->aw_period) {
        /* tx_counter: TU to its next slot boundary (an iPhone sends 25..47, more than one AW); aw_seq: the number of
         * the AW that starts there */
        p->has_sync = 1;
        p->sync_start = t + (int64_t)f->tx_counter * AWDL_TU_US;
        p->sync_seq = f->aw_seq;
    }
    if (f->has_election) {
        memcpy(p->master, f->master, 6);
        p->master_metric = f->master_metric;
        p->master_counter = f->master_counter;
        p->distance = f->distance;
    }
    if (!p->valid && p->seen_mif && f->awdl_version > 0 && f->devclass > 0) {
        p->valid = 1;
        neighbour(p, 1);
        char ll[64];
        awdl_link_local(p->mac, ll, sizeof(ll));
        say("neighbour: %s %s (%s) %d dBm, %s%%%s", mac_text(p->mac), p->hostname, awdl_devclass_name(p->devclass), f->rssi, ll, TAP);
        if (verbose && f->has_sync)
            say("  sync: next AW %u in %u TU on channel %u, master channel %u, sequence %s%s", f->aw_seq, f->tx_counter,
                f->next_aw_channel, f->master_channel, p->has_chanseq ? "" : "(none)", "");
        if (p->has_chanseq) {
            char text[128] = "";
            int ours = 0;
            for (int i = 0; i < AWDL_SLOTS; i++) {
                snprintf(text + strlen(text), sizeof(text) - strlen(text), "%d ", p->chanseq[i]);
                ours += p->chanseq[i] == self.channel;
            }
            say("  channels per slot: %s", text);
            if (!ours)
                say("  NOTE: it does not come to channel %d now. Connect the iPhone to the same Wi-Fi network as this "
                    "computer (then it uses that channel too), or run with --take-card (AWDL on 149 without the network).",
                    self.channel);
            else
                say("  it comes to channel %d in %d of %d slots", self.channel, ours, AWDL_SLOTS);
        }
    }
}

/* The driver reports every frame we sent back on the monitor interface with radiotap TX flags (bit 15: 0x0001
 * failed, no acknowledgement) and data retries (bit 17). For unicast frames this says whether the peer got them. */
static long unicast_acked, unicast_failed;
static void tx_status(const uint8_t *p, size_t length)
{
    if (length < 8)
        return;
    size_t rt = (size_t)(p[2] | p[3] << 8);
    uint32_t present = (uint32_t)(p[4] | p[5] << 8 | p[6] << 16 | (uint32_t)p[7] << 24);
    if (!(present & (1u << 15)) || present & 0x80000000u || length < rt + 24)
        return;
    size_t off = 8;
    static const struct { int bit, size, align; } fields[] = {
        {0, 8, 8}, {1, 1, 1}, {2, 1, 1}, {3, 4, 2}, {4, 2, 1}, {5, 1, 1}, {6, 1, 1}, {7, 2, 2}, {8, 2, 2}, {9, 2, 2},
        {10, 1, 1}, {11, 1, 1}, {12, 1, 1}, {13, 1, 1}, {14, 2, 2}, {15, 2, 2},
    };
    int flags = -1;
    for (size_t i = 0; i < sizeof(fields) / sizeof(fields[0]); i++) {
        if (!(present & (1u << fields[i].bit)))
            continue;
        off = (off + fields[i].align - 1) & ~(size_t)(fields[i].align - 1);
        if (off + fields[i].size > rt)
            return;
        if (fields[i].bit == 15)
            flags = p[off] | p[off + 1] << 8;
        off += fields[i].size;
    }
    const uint8_t *f = p + rt;
    if ((f[0] & 0x0c) == 0x08 && !(f[1] & 0x08)) {
        uint16_t seq = (uint16_t)((f[22] | f[23] << 8) >> 4);
        int64_t at = sent_at[seq & 4095];
        if (at) {
            int64_t took = now_us() - at;
            sent_at[seq & 4095] = 0;
            latency_sum += took;
            latency_count++;
            if (took > latency_max)
                latency_max = took;
        }
    }
    if (flags < 0 || (f[4] & 1))
        return;                   /* broadcast and multicast are never acknowledged */
    if (flags & 0x0001)
        unicast_failed++;
    else
        unicast_acked++;
}

/* An 802.11 data frame in the AWDL BSS (whatever its body), and its transmitter. */
static int looks_awdl_data(const uint8_t *packet, size_t length, uint8_t src[6])
{
    if (length < 8)
        return 0;
    size_t rt = (size_t)(packet[2] | packet[3] << 8);
    if (length < rt + 24)
        return 0;
    const uint8_t *f = packet + rt;
    if ((f[0] & 0x0c) != 0x08 || memcmp(f + 16, AWDL_BSSID, 6) != 0)
        return 0;
    memcpy(src, f + 10, 6);
    return 1;
}

/* One line about an IPv6 packet (for the log): TCP ports and flags, ICMPv6 type. */
static void describe(const char *direction, const uint8_t *ether, size_t length)
{
    if (length < 14 + 40 || ether[12] != 0x86 || ether[13] != 0xdd)
        return;
    const uint8_t *ip = ether + 14;
    int next = ip[6];
    char what[96];
    if (next == 6 && length >= 14 + 40 + 14) {
        const uint8_t *t = ip + 40;
        int flags = t[13] | (t[12] & 1) << 8;
        snprintf(what, sizeof(what), "TCP %u->%u %s%s%s%s%s", t[0] << 8 | t[1], t[2] << 8 | t[3],
            flags & 0x02 ? "SYN " : "", flags & 0x10 ? "ACK " : "", flags & 0x01 ? "FIN " : "", flags & 0x04 ? "RST " : "",
            flags & 0x08 ? "PSH" : "");
    } else if (next == 58) {
        snprintf(what, sizeof(what), "ICMPv6 type %u", ip[40]);
    } else if (next == 17 && length >= 14 + 48) {
        snprintf(what, sizeof(what), "UDP %u->%u", ip[40] << 8 | ip[41], ip[42] << 8 | ip[43]);
    } else {
        snprintf(what, sizeof(what), "IPv6 next header %d", next);
    }
    say("%s %s %s (%zu bytes)", direction, mac_text(ether[0] & 1 ? ether + 6 : direction[0] == '<' ? ether + 6 : ether), what, length);
}

static void to_tap(const uint8_t *ether, size_t length, void *context)
{
    (void)context;
    /* ours (unicast) or multicast */
    if (memcmp(ether, self.mac, 6) != 0 && !(ether[0] & 1))
        return;
    if (!(ether[0] & 1))
        describe("awdl0 <-", ether, length);
    if (write(tap_fd, ether, length) < 0)
        say("awdl0 write failed: %s", strerror(errno));
    rx_data++;
}

static void on_monitor(int64_t t)
{
    uint8_t packet[4096];
    ssize_t n = recv(monitor_fd, packet, sizeof(packet), MSG_DONTWAIT);
    if (n <= 0)
        return;
    struct awdl_frame f;
    if (awdl_parse(packet, (size_t)n, &f)) {
        capture_write(packet, (size_t)n);
        if (memcmp(f.src, self.mac, 6) == 0) {
            rx_echo++;
            echoed++;
            last_echo = t;
        } else {
            on_action(&f, t);
        }
        return;
    }
    /* data: only what others sent (our own frames come back on the monitor interface too) */
    uint8_t src[6];
    if (looks_awdl_data(packet, (size_t)n, src)) {
        capture_write(packet, (size_t)n);
        if (memcmp(src, self.mac, 6) == 0) {
            rx_echo++;
            echoed++;
            last_echo = t;
            tx_status(packet, (size_t)n);
            return;
        }
        struct peer *p = find_peer(src);
        /* the same frame again (retry bit, same sequence control): we do not acknowledge in every mode, so iPhones
         * repeat; the kernel needs it once */
        size_t rt = (size_t)(packet[2] | packet[3] << 8);
        const uint8_t *f = packet + rt;
        uint16_t seqctl = (uint16_t)(f[22] | f[23] << 8);
        if (p && (f[1] & 0x08) && p->has_last_seqctl && p->last_seqctl == seqctl) {
            p->heard = t;
            rx_dup++;
            return;
        }
        if (p) {
            p->last_seqctl = seqctl;
            p->has_last_seqctl = 1;
        }
        int delivered = awdl_unwrap_data(packet, (size_t)n, src, to_tap, NULL);
        if (p) {
            p->heard = t;
            p->rx_data++;
        }
        if (verbose && (!p || p->rx_data <= 20))
            say("data frame from %s (%s), %zd bytes, %d packet(s) for awdl0", mac_text(src), p ? "neighbour" : "unknown",
                n, delivered);
    }
}

static void on_tap(void)
{
    uint8_t ether[2400];
    ssize_t n = read(tap_fd, ether, sizeof(ether));
    if (n < 14)
        return;
    tap_in++;
    if (ether[0] & 1) {
        enqueue(multicast, &n_multicast, ether, (size_t)n);
        return;
    }
    struct peer *p = find_peer(ether);
    describe("awdl0 ->", ether, (size_t)n);
    if (p && p->valid)
        enqueue(p->queue, &p->queued, ether, (size_t)n);
    else
        say("  dropped: %s is not an AWDL neighbour (now)", mac_text(ether));
}

/* --- our channel -------------------------------------------------------------------------------------------- */

static int exclusive;         /* the card is ours: we may change its channel */

/* What we say about our channel in the frames. */
static void describe_channel(int channel)
{
    self.channel = (uint8_t)channel;
    self.opclass = channel <= 14 ? 0x51 : 0x80;
    /* the legacy encoding: 2.4 GHz 20 MHz primary, or 5 GHz 40 MHz with 149/153 style pairs */
    if (channel <= 14) {
        self.legacy_flags = 0x2b;
        self.legacy_channel = (uint8_t)channel;
    } else {
        int upper = ((channel - 36) / 4) % 2 == 1;   /* 40, 48, ... 153, 161: the upper half of their pair */
        self.legacy_flags = upper ? 0x1e : 0x1d;
        self.legacy_channel = (uint8_t)(upper ? channel - 2 : channel + 2);
    }
}

/* Tunes the card (only when it is ours): 80 MHz on 5 GHz so that wide frames are heard too. */
static void tune(int channel)
{
    /* the station interface stays down while the card is ours: up, the card no longer sends what we inject
     * (seen: not one of our frames on the air), and it refuses to change channel */
    if (channel == 149)
        sh("iw dev %s set freq 5745 80 5775 2>/dev/null || iw dev %s set channel 149", MONITOR, MONITOR);
    else if (channel == 44)
        sh("iw dev %s set freq 5220 80 5210 2>/dev/null || iw dev %s set channel 44", MONITOR, MONITOR);
    else {
        char number[8];
        snprintf(number, sizeof(number), "%d", channel);
        sh("iw dev %s set channel %s 2>/dev/null", MONITOR, number);
    }
    describe_channel(channel);
}

/* The channel an Apple device spends most of its slots on (0 when it says nothing). */
static int favourite_channel(const struct peer *p)
{
    int best = 0, best_count = 0;
    for (int i = 0; i < AWDL_SLOTS; i++) {
        int c = p->chanseq[i], count = 0;
        if (!c)
            continue;
        for (int j = 0; j < AWDL_SLOTS; j++)
            count += p->chanseq[j] == c;
        if (count > best_count) {
            best = c;
            best_count = count;
        }
    }
    return best;
}

/* --- setup -------------------------------------------------------------------------------------------------- */

static int open_tap(void)
{
    int fd = open("/dev/net/tun", O_RDWR | O_NONBLOCK);
    if (fd < 0)
        return -1;
    struct ifreq ifr;
    memset(&ifr, 0, sizeof(ifr));
    ifr.ifr_flags = IFF_TAP | IFF_NO_PI;
    snprintf(ifr.ifr_name, sizeof(ifr.ifr_name), "%s", TAP);
    if (ioctl(fd, TUNSETIFF, &ifr) < 0) {
        close(fd);
        return -1;
    }
    return fd;
}

static void cleanup(void)
{
    for (int i = n_peers - 1; i >= 0; i--)
        forget_peer(i);
    drop_queue(multicast, &n_multicast);
    if (tap_fd >= 0)
        close(tap_fd);
    if (monitor_fd >= 0)
        close(monitor_fd);
    sh("ip link set %s down 2>/dev/null; iw dev %s del 2>/dev/null", MONITOR, MONITOR);
    if (took_card) {
        sh("ip link set %s up 2>/dev/null", wifi);
        sh("nmcli device set %s managed yes 2>/dev/null", wifi);
        /* back on the network it was on */
        /* back on the network it was on (or any it knows), in the background so that stopping is quick */
        if (saved_connection[0])
            sh("(sleep 1; nmcli connection up id '%s' >/dev/null 2>&1 || nmcli device connect %s >/dev/null 2>&1) &",
                saved_connection, wifi);
        else
            sh("(sleep 1; nmcli device connect %s >/dev/null 2>&1) &", wifi);
        say("Wi-Fi given back to the system: it reconnects in a few seconds");
    }
}

int main(int argc, char **argv)
{
    int want_channel = 149, take_card = 0;
    const char *name = NULL;
    const char *capture_path = NULL;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--channel") == 0 && i + 1 < argc)
            want_channel = atoi(argv[++i]);
        else if (strcmp(argv[i], "--take-card") == 0)
            take_card = 1;
        else if (strcmp(argv[i], "--name") == 0 && i + 1 < argc)
            name = argv[++i];
        else if (strcmp(argv[i], "--verbose") == 0)
            verbose = 1;
        else if (strcmp(argv[i], "--capture") == 0 && i + 1 < argc)
            capture_path = argv[++i];
        else if (strcmp(argv[i], "--service") == 0 && i + 1 < argc)
            snprintf(self_service, sizeof(self_service), "%.30s", argv[++i]);
        else if (strcmp(argv[i], "--port") == 0 && i + 1 < argc)
            self_port = atoi(argv[++i]);
        else if (strcmp(argv[i], "--txt") == 0 && i + 1 < argc)
            snprintf(self_txt, sizeof(self_txt), "%.60s", argv[++i]);
        else {
            fprintf(stderr, "usage: osmin-awdld [--channel 149|44|6] [--take-card] [--name NAME] [--service ID --port N --txt flags=N] [--verbose]\n");
            return 1;
        }
    }
    if (geteuid() != 0) {
        fprintf(stderr, "osmin-awdld needs root\n");
        return 1;
    }
    if (!find_wifi()) {
        fprintf(stderr, "no Wi-Fi card found\n");
        return 1;
    }
    memset(&self, 0, sizeof(self));
    if (!read_mac(wifi, self.mac)) {
        fprintf(stderr, "cannot read the MAC of %s\n", wifi);
        return 1;
    }
    char host[64];
    gethostname(host, sizeof(host));
    snprintf(self.hostname, sizeof(self.hostname), "%.60s", name ? name : host);

    int connected = current_channel();
    if (take_card) {
        sh("nmcli radio wifi on 2>/dev/null; rfkill unblock wifi 2>/dev/null");
        if (connected) {
            char command[160];
            snprintf(command, sizeof(command), "nmcli -g GENERAL.CONNECTION device show %s 2>/dev/null", wifi);
            FILE *p = popen(command, "r");
            if (p && fgets(saved_connection, sizeof(saved_connection), p))
                saved_connection[strcspn(saved_connection, "\n")] = 0;
            if (p)
                pclose(p);
            for (char *c = saved_connection; *c; c++) {
                if (*c == '\'')
                    *c = 0;
            }
            say("leaving %s for now (%s); it comes back when this stops", wifi, saved_connection[0] ? saved_connection : "Wi-Fi");
            sh("nmcli device disconnect %s >/dev/null 2>&1", wifi);
        }
        sh("nmcli device set %s managed no 2>/dev/null", wifi);
        /* down, or the card refuses to change channel (EBUSY) */
        sh("ip link set %s down 2>/dev/null", wifi);
        took_card = 1;
        usleep(500000);
        connected = 0;
    }
    int channel = connected ? connected : want_channel;
    /* An iPhone connected to a network spends many of its AWDL slots on that network's channel: sharing the card's
     * channel works on any channel the iPhone's network uses too. */
    describe_channel(channel);
    snprintf(self.service, sizeof(self.service), "%s", self_service);
    snprintf(self.txt, sizeof(self.txt), "%s", self_txt);
    self.service_port = (uint16_t)self_port;
    {
        FILE *p = popen("iw reg get 2>/dev/null", "r");
        char line[160];
        while (p && fgets(line, sizeof(line), p)) {
            char cc[3];
            if (sscanf(line, "country %2[A-Z0-9]:", cc) == 1 && strcmp(cc, "00") != 0) {
                memcpy(self.country, cc, 3);
                break;
            }
        }
        if (p)
            pclose(p);
    }
    self.self_metric = 60;
    self.self_counter = 0;
    memcpy(self.master, self.mac, 6);
    memcpy(self.sync_from, self.mac, 6);
    self.master_metric = 60;

    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);
    signal(SIGPIPE, SIG_IGN);

    sh("ip link set %s down 2>/dev/null; iw dev %s del 2>/dev/null", MONITOR, MONITOR);
    if (sh("iw phy %s interface add %s type monitor flags active 2>/dev/null || iw phy %s interface add %s type monitor", phy, MONITOR, phy, MONITOR) != 0 ||
        sh("ip link set %s up", MONITOR) != 0) {
        fprintf(stderr, "could not add a monitor interface beside %s\n", wifi);
        cleanup();
        return 1;
    }
    exclusive = !connected;
    if (exclusive)
        tune(channel);
    monitor_fd = socket(AF_PACKET, SOCK_RAW, htons(ETH_P_ALL));
    struct sockaddr_ll where = {.sll_family = AF_PACKET, .sll_protocol = htons(ETH_P_ALL), .sll_ifindex = (int)if_nametoindex(MONITOR)};
    if (monitor_fd < 0 || bind(monitor_fd, (struct sockaddr *)&where, sizeof(where)) < 0) {
        perror("monitor socket");
        cleanup();
        return 1;
    }
    tap_fd = open_tap();
    if (tap_fd < 0) {
        perror("awdl0 (TAP)");
        cleanup();
        return 1;
    }
    sh("nmcli device set %s managed no 2>/dev/null", TAP);
    sh("sysctl -qw net.ipv6.conf.%s.accept_ra=0 net.ipv6.conf.%s.dad_transmits=0 net.ipv6.conf.%s.addr_gen_mode=0 2>/dev/null", TAP, TAP, TAP);
    sh("ip link set %s address %s mtu 1450 up", TAP, mac_text(self.mac));

    if (capture_path)
        capture_open(capture_path);
    /* only the address made from the MAC (what Apple devices derive for us): no random second link-local */
    char ll[64];
    awdl_link_local(self.mac, ll, sizeof(ll));
    sh("ip -6 addr flush dev %s scope link 2>/dev/null; ip -6 addr add %s/64 dev %s nodad 2>/dev/null", TAP, ll, TAP);
    say("AWDL on %s channel %d (%s), %s %s, name %s", wifi, channel, connected ? "shared with the Wi-Fi connection" : "the card is ours",
        TAP, ll, self.hostname);
    say("open the share sheet on the iPhone (AirDrop: Everyone for 10 minutes)");

    clock_start = now_us();
    clock_seq = 0;
    int64_t next_report = now_us() + 5000000, burst_at = now_us();
    /* the card is ours and nobody is heard: look on the social channels in turn */
    static const int SEARCH[] = {149, 6, 44};
    int search_index = 0;
    int64_t next_hop = now_us() + 1500000, last_heard = now_us();
    int burst_left = 64;
    uint16_t last_aw = 0xffff;
    int64_t last_action = 0;
    while (!stop) {
        int64_t t = now_us();
        uint16_t seq;
        int64_t start;
        aw_at(t, &seq, &start);

        /* forget the silent */
        for (int i = n_peers - 1; i >= 0; i--) {
            if (t - peers[i].heard > PEER_TIMEOUT_US)
                forget_peer(i);
        }
        elect();
        aw_at(t, &seq, &start);

        if (exclusive) {
            struct peer *followed = synced ? find_peer(sync_source) : NULL;
            for (int i = 0; i < n_peers; i++) {
                if (peers[i].valid)
                    last_heard = t;
            }
            if (followed && followed->has_chanseq) {
                /* go where it spends most of its time */
                int want = favourite_channel(followed);
                if (want && want != self.channel && t >= next_hop) {
                    say("it spends most slots on channel %d: going there", want);
                    tune(want);
                    next_hop = t + 3000000;
                }
            } else if (!n_peers && t - last_heard > 3000000 && t >= next_hop) {
                search_index = (search_index + 1) % 3;
                if (verbose)
                    say("nobody heard: looking on channel %d", SEARCH[search_index]);
                tune(SEARCH[search_index]);
                next_hop = t + 1500000;
            }
        }

        if (!synced) {
            /* nobody to follow: bursts of MIFs, one every AW, then a pause */
            if (t >= burst_at && backlog() < 4) {
                send_action(AWDL_SUBTYPE_MIF);
                burst_at = t + AW_US;
                if (--burst_left == 0) {
                    burst_left = 64;
                    burst_at = t + 3000000;
                }
            }
            drop_queue(multicast, &n_multicast);
        } else {
            /* We stay on our channel; the Apple device is on it only in some slots (and asleep or elsewhere in the
             * rest). A MIF/PSF every AW; data only inside an AW where the device is here, away from the AW's edges:
             * sent when it is away, the card would retry each frame until it comes back, and everything behind
             * waits (that once held a TLS answer back for 3 s). */
            (void)last_aw;
            int inside = t >= start + GUARD_US && t < start + AW_US - GUARD_US;
            int anyone = 0;
            for (int i = 0; i < n_peers; i++) {
                if (!peers[i].valid)
                    continue;
                /* here by its schedule, or it just sent us something (then it is awake on our channel now) */
                int awake = t - peers[i].heard < 30000;
                if ((peer_here(&peers[i], seq) && inside) || awake) {
                    anyone = 1;
                    if (peers[i].queued)
                        flush_peer(&peers[i]);
                }
            }
            if (anyone && inside) {
                for (int i = 0; i < n_multicast && backlog() < 24; i++)
                    send_ether(multicast[i]->data, multicast[i]->length);
                drop_queue(multicast, &n_multicast);
            }
            /* our MIF once per action frame period (110 TU, as the protocol says; iPhones send fewer still), while the
             * device is here, and only when the card has nothing else waiting: data first */
            if (t - last_action >= (int64_t)AWDL_AF_PERIOD_TU * AWDL_TU_US && anyone && backlog() < 2) {
                send_action(AWDL_SUBTYPE_MIF);
                last_action = t;
            }
        }

        if (t >= next_report) {
            next_report = t + 5000000;
            say("heard %ld AWDL frames and %ld data frames from others (%ld of ours echoed); sent %ld AWDL frames, %ld data, %ld failed; %d device(s), %s",
                rx_af, rx_data, rx_echo, sent_af, sent_data, send_errors, n_peers, synced ? "in sync" : "announcing");
            if (unicast_acked || unicast_failed)
                say("  unicast to Apple devices: %ld acknowledged (they hear us), %ld not", unicast_acked, unicast_failed);
            if (rx_dup)
                say("  %ld repeated frames from Apple devices skipped (they repeat what we do not acknowledge)", rx_dup);
            say("  card queue: %ld waiting, %ld never came back", backlog(), lost);
            if (latency_count) {
                say("  data frames out on the air after %lld ms on average, %lld ms at most (%ld frames)",
                    (long long)(latency_sum / latency_count / 1000), (long long)(latency_max / 1000), latency_count);
                latency_sum = latency_max = 0;
                latency_count = 0;
            }
            for (int i = 0; i < n_peers; i++) {
                struct peer *p = &peers[i];
                say("  %s %-38s %-12s %s frames %ld data in %ld out %ld waiting %d%s", mac_text(p->mac), p->hostname,
                    awdl_devclass_name(p->devclass), p->valid ? "neighbour" : (p->seen_mif ? "no version yet" : "no MIF yet"),
                    p->rx_frames, p->rx_data, p->tx_data, p->queued, peer_here(p, seq) ? ", on our channel now" : "");
            }
        }

        /* wait for a frame, a packet to send, or the next AW */
        int64_t wake = synced ? start + AW_US + GUARD_US : burst_at;
        int timeout = (int)((wake - now_us()) / 1000);
        if (timeout < 0)
            timeout = 0;
        if (timeout > 20)
            timeout = 20;
        struct pollfd fds[2] = {{.fd = monitor_fd, .events = POLLIN}, {.fd = tap_fd, .events = POLLIN}};
        if (poll(fds, 2, timeout) > 0) {
            int64_t when = now_us();
            if (fds[0].revents & POLLIN) {
                for (int k = 0; k < 64; k++) {
                    struct pollfd one = {.fd = monitor_fd, .events = POLLIN};
                    if (poll(&one, 1, 0) <= 0)
                        break;
                    on_monitor(when);
                }
            }
            if (fds[1].revents & POLLIN)
                on_tap();
        }
    }
    say("stopping");
    if (capture)
        fclose(capture);
    cleanup();
    return 0;
}
