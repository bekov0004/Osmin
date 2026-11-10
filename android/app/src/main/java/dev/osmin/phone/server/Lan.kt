package dev.osmin.phone.server

import java.io.File
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.util.concurrent.Callable
import java.util.concurrent.Executors

/** An IPv4 address of one of the phone's own networks. */
data class LocalNet(val name: String, val address: String, val prefix: Int)

/**
 * Where the computer may be, in whatever network the phone is in now: the phone on the computer's Wi-Fi, on a hotspot the
 * computer shares, the phone sharing its own hotspot (the computer is a client of it), or a cable (USB tethering). Nothing
 * is known by name, so the network of each interface is searched for the one port the computer listens on.
 */
object Lan {
    private const val MAX_PREFIX_SIZE = 22      // search at most 1022 addresses of one network
    private val IGNORED = listOf("lo", "rmnet", "ccmni", "tun", "ppp", "dummy", "ifb", "clat", "v4-", "ip6", "sit", "p2p-dev", "bt-pan")

    private fun ip(text: String): Long = text.split('.').fold(0L) { acc, part -> acc * 256 + part.toLong() }
    private fun text(ip: Long) = "${ip shr 24 and 255}.${ip shr 16 and 255}.${ip shr 8 and 255}.${ip and 255}"

    /** Private addresses only (the carrier's network and the internet are not where the computer is). */
    fun isPrivate(address: String): Boolean {
        val parts = address.split('.').mapNotNull { it.toIntOrNull() }
        if (parts.size != 4)
            return false
        return parts[0] == 10 || (parts[0] == 172 && parts[1] in 16..31) || (parts[0] == 192 && parts[1] == 168)
    }

    /** The phone's own networks that can hold the computer. */
    fun localNets(): List<LocalNet> {
        val found = mutableListOf<LocalNet>()
        val interfaces = try {
            NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
        } catch (e: Exception) {
            return found
        }
        for (net in interfaces) {
            if (IGNORED.any { net.name.startsWith(it) } || !net.isUp)
                continue
            for (address in net.interfaceAddresses) {
                val inet = address.address as? Inet4Address ?: continue
                val text = inet.hostAddress ?: continue
                if (isPrivate(text) && address.networkPrefixLength in 8..30)
                    found += LocalNet(net.name, text, address.networkPrefixLength.toInt())
            }
        }
        return found
    }

    /** The addresses in /proc/net/arp that answered lately (machines that talked to this phone). */
    fun parseArp(text: String): List<String> = text.lines().drop(1).mapNotNull { line ->
        val parts = line.trim().split(Regex("\\s+"))
        // IP address, HW type, Flags (0x2: complete), HW address, Mask, Device
        if (parts.size >= 4 && parts[2] == "0x2" && parts[3] != "00:00:00:00:00:00") parts[0] else null
    }

    fun readArp(): List<String> = try {
        parseArp(File("/proc/net/arp").readText())
    } catch (e: Exception) {
        emptyList()
    }

    /**
     * The addresses to try, most likely first: the one that worked, the machines the phone already talked to (the
     * gateway among them), the first address of the network (what a shared connection gives the computer), then the
     * rest of the network. The phone's own address is left out.
     */
    fun candidates(nets: List<LocalNet>, neighbours: List<String>, last: String?): List<String> {
        val result = LinkedHashSet<String>()
        val own = nets.map { it.address }.toSet()
        last?.let { result += it }
        val ranges = nets.map { net ->
            val prefix = if (net.prefix < MAX_PREFIX_SIZE) 24 else net.prefix
            val size = 1L shl (32 - prefix)
            val start = ip(net.address) / size * size
            start to start + size
        }
        fun inRanges(address: String) = ranges.any { (from, to) -> ip(address) in from until to }
        neighbours.filter { isPrivate(it) && inRanges(it) }.forEach { result += it }
        ranges.forEach { (from, _) -> result += text(from + 1) }
        for ((from, to) in ranges)
            for (n in from + 1 until to - 1)
                result += text(n)
        result -= own
        return result.toList()
    }

    /** Which of the [hosts] have [port] open, in the order given. Quick: all asked at once. */
    fun open(hosts: List<String>, port: Int, timeoutMs: Int = 500, threads: Int = 64): List<String> {
        if (hosts.isEmpty())
            return emptyList()
        val pool = Executors.newFixedThreadPool(minOf(threads, hosts.size))
        try {
            val answers = pool.invokeAll(hosts.map { host ->
                Callable {
                    try {
                        Socket().use { it.connect(InetSocketAddress(host, port), timeoutMs); true }
                    } catch (e: Exception) {
                        false
                    }
                }
            })
            return hosts.filterIndexed { i, _ -> answers[i].get() }
        } finally {
            pool.shutdownNow()
        }
    }
}
