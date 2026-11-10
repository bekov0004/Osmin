package dev.osmin.phone.start

import dev.osmin.phone.adb.AdbConnection
import dev.osmin.phone.adb.AdbKey
import dev.osmin.phone.adb.PairingClient
import dev.osmin.phone.adb.PeerInfo

/** A host and a port found on the network. */
data class Address(val host: String, val port: Int)

/** Finds the services adbd publishes on the phone itself: "_adb-tls-pairing._tcp" and "_adb-tls-connect._tcp". */
interface Discovery {
    /** @return where the service is, or null if it did not appear in time */
    fun find(serviceType: String, timeoutMs: Long): Address?
}

class StartException(message: String) : Exception(message)

/**
 * What the app does with the phone's own adbd, with no computer: pair with the code the user reads from the Wireless
 * debugging screen, and, when there is somewhere to connect to, start the phone's server through adbd (the way scrcpy or
 * Shizuku start theirs), which then dials the computer.
 */
class Starter(
    private val key: AdbKey,
    private val discovery: Discovery,
    private val apkPath: String,
    private val log: (String) -> Unit = {},
) {
    /** Pairs this app's key with the phone's adbd. The pairing dialog must be open on the phone. */
    fun pair(code: String, timeoutMs: Long = 10_000): PeerInfo {
        if (code.length < 4 || !code.all { it.isDigit() })
            throw StartException("The pairing code is the number shown in the pairing window.")
        val address = discovery.find(PAIRING, timeoutMs)
            ?: throw StartException("The pairing window is not open. Tap \"Pair device with pairing code\" in Wireless debugging first.")
        log("pairing with ${address.host}:${address.port}")
        try {
            return PairingClient(key).pair(address.host, address.port, code)
        } catch (e: java.io.IOException) {
            throw StartException("Pairing did not work (${e.message ?: "wrong code?"}). Check the code and try again.")
        }
    }

    /** Starts the phone's server so that it connects to [target]. Needs a paired key and Wireless debugging on. */
    fun start(target: ConnectTarget, timeoutMs: Long = 10_000) {
        val address = discovery.find(CONNECT, timeoutMs)
            ?: throw StartException("Wireless debugging is not on, or the phone is not on Wi-Fi.")
        log("connecting to adbd at ${address.host}:${address.port}")
        try {
            AdbConnection(key).use { connection ->
                connection.connect(address.host, address.port)
                connection.shell(StartCommand.build(apkPath, target))
            }
        } catch (e: java.io.IOException) {
            throw StartException("The phone's debugging service did not accept this app (${e.message}). If this is the first time, pair first.")
        }
    }

    companion object {
        const val PAIRING = "_adb-tls-pairing._tcp"
        const val CONNECT = "_adb-tls-connect._tcp"
    }
}
