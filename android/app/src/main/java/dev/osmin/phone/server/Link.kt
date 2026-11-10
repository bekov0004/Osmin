package dev.osmin.phone.server

import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket

/** Where the computer listens, and the secret from the QR code that proves this is the phone it expects. */
data class Endpoint(val host: String, val port: Int, val token: String)

/**
 * The phone dials the computer (so it works in a network the phone shares as well as in one the computer shares,
 * with nothing found by name): two connections, `C` for the control lines and `V` for the raw H.264 picture.
 * Each starts with "HELLO <role> <token> <info>" and waits for "OK".
 */
object Link {
    const val CONNECT_TIMEOUT_MS = 8000

    fun open(endpoint: Endpoint, role: Char, info: String): Socket {
        val socket = Socket()
        try {
            socket.tcpNoDelay = true
            socket.connect(InetSocketAddress(endpoint.host, endpoint.port), CONNECT_TIMEOUT_MS)
            socket.soTimeout = CONNECT_TIMEOUT_MS
            val out = socket.getOutputStream()
            out.write("HELLO $role ${endpoint.token} $info\n".toByteArray())
            out.flush()
            val answer = readLine(socket)
            if (answer != "OK")
                throw IOException("the computer refused the $role connection: $answer")
            socket.soTimeout = 0
            return socket
        } catch (e: IOException) {
            socket.close()
            throw e
        }
    }

    /** Reads up to the newline without reading past it (what follows may be raw video). */
    fun readLine(socket: Socket): String {
        val input = socket.getInputStream()
        val bytes = java.io.ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0)
                throw IOException("the connection closed")
            if (b == '\n'.code)
                break
            if (bytes.size() > 4096)
                throw IOException("a line is too long")
            bytes.write(b)
        }
        return bytes.toString(Charsets.UTF_8.name()).trimEnd('\r')
    }
}
