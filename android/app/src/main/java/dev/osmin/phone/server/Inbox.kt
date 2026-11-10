package dev.osmin.phone.server

import java.io.IOException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket

/**
 * The phone also listens, so the computer can reach it too: wake it, unlock it, see it, without the phone having
 * found the computer first (a phone that is asleep still answers on the network, which a search it runs itself does
 * not). The computer dials twice, like the phone does the other way round (C and V), and proves it knows the secret
 * (see Link.accept); the phone serves it as soon as both connections are there.
 *
 * @param serve serves a computer that is connected (blocks until the session is over)
 */
class Inbox(
    private val port: Int,
    private val token: String,
    private val greeting: () -> String,
    private val serve: (control: Socket, video: Socket) -> Unit,
    private val log: (String) -> Unit = {},
    private val waitMs: Long = 10_000,
) {
    private var server: ServerSocket? = null
    private val waiting = HashMap<Char, Pair<Socket, Long>>()

    val boundPort: Int get() = server?.localPort ?: -1

    /** Binds the port; false when it is taken. */
    fun open(): Boolean = try {
        server = ServerSocket().also {
            it.reuseAddress = true
            it.bind(InetSocketAddress(port))
        }
        true
    } catch (e: IOException) {
        log("cannot listen on $port: ${e.message}")
        false
    }

    /** Accepts connections until [close]. */
    fun run() {
        val listening = server ?: return
        while (!listening.isClosed) {
            val socket = try {
                listening.accept()
            } catch (e: IOException) {
                break
            }
            Thread { greet(socket) }.also { it.isDaemon = true; it.start() }
        }
    }

    fun close() {
        try { server?.close() } catch (e: IOException) { /* closed */ }
        synchronized(waiting) { waiting.values.forEach { closeQuietly(it.first) }; waiting.clear() }
    }

    private fun greet(socket: Socket) {
        val role = try {
            socket.tcpNoDelay = true
            Link.accept(socket, token, greeting())
        } catch (e: Exception) {
            null
        }
        if (role == null) {
            closeQuietly(socket)
            return
        }
        var pair: Pair<Socket, Socket>? = null
        synchronized(waiting) {
            val now = System.currentTimeMillis()
            waiting.entries.removeAll { (_, entry) -> (now - entry.second > waitMs).also { old -> if (old) closeQuietly(entry.first) } }
            waiting.put(role, socket to now)?.let { closeQuietly(it.first) }
            val control = waiting[ 'C' ]
            val video = waiting[ 'V' ]
            if (control != null && video != null) {
                pair = control.first to video.first
                waiting.clear()
            }
        }
        pair?.let { (control, video) ->
            try {
                serve(control, video)
            } catch (e: Exception) {
                log("a session ended badly: ${e.message}")
            }
        }
    }

    private fun closeQuietly(socket: Socket) {
        try { socket.close() } catch (e: IOException) { /* closed */ }
    }
}
