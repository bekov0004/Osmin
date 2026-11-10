package dev.osmin.phone.server

import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Where the computer listens, and the secret from the QR code that proves this is the phone it expects. */
data class Endpoint(val host: String, val port: Int, val token: String)

/**
 * The phone dials the computer (so it works in a network the phone shares as well as in one the computer shares):
 * two connections, `C` for the control lines and `V` for the raw H.264 picture.
 *
 * The phone looks for the computer in whatever network it is in, so it may knock on other machines too. The secret is
 * therefore never sent: each side proves it knows it.
 *
 *     phone    HELLO2 <role> <fingerprint of the secret> <nonce P>
 *     computer CHAL <nonce C> <HMAC(secret, "srv|P|C")>     the phone checks that this is the computer
 *     phone    AUTH <HMAC(secret, "cli|C|P")> <info>         the computer checks that this is the phone
 *     computer OK
 *
 * The computer may also dial the phone (accept below), with the roles swapped.
 */
object Link {
    const val CONNECT_TIMEOUT_MS = 8000
    private val random = SecureRandom()

    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    /** Eight hex digits that say which secret is meant, without giving it away. */
    fun fingerprint(token: String): String = hex(MessageDigest.getInstance("SHA-256").digest(token.toByteArray())).substring(0, 8)

    /** The proof of one side: [who] is "srv" or "cli". */
    fun proof(token: String, who: String, first: String, second: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(token.toByteArray(), "HmacSHA256"))
        return hex(mac.doFinal("$who|$first|$second".toByteArray()))
    }

    private fun nonce(): String = hex(ByteArray(16).also(random::nextBytes))

    fun open(endpoint: Endpoint, role: Char, info: String, connectTimeoutMs: Int = CONNECT_TIMEOUT_MS): Socket {
        val socket = Socket()
        try {
            socket.tcpNoDelay = true
            socket.connect(InetSocketAddress(endpoint.host, endpoint.port), connectTimeoutMs)
            socket.soTimeout = connectTimeoutMs
            val out = socket.getOutputStream()
            val mine = nonce()
            out.write("HELLO2 $role ${fingerprint(endpoint.token)} $mine\n".toByteArray())
            out.flush()
            val challenge = readLine(socket).split(' ')
            if (challenge.size != 3 || challenge[0] != "CHAL")
                throw IOException("the computer refused the $role connection: ${challenge.joinToString(" ")}")
            if (!MessageDigest.isEqual(challenge[2].toByteArray(), proof(endpoint.token, "srv", mine, challenge[1]).toByteArray()))
                throw IOException("this is not the computer (it does not know the secret)")
            out.write("AUTH ${proof(endpoint.token, "cli", challenge[1], mine)} $info\n".toByteArray())
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

    /**
     * The other direction: the computer dials the phone, which listens (see Inbox). The same greeting with the roles
     * swapped: the dialer (the computer) says HELLO2, the phone answers CHAL with its proof, the computer AUTHs, and the
     * phone says "OK <info>" (the computer learns the screen's size from it).
     * @return the role of this connection ('C' or 'V'), or null when it was refused (and answered NO)
     */
    fun accept(socket: Socket, token: String, info: String, greetingMs: Int = 5000): Char? {
        socket.soTimeout = greetingMs
        val out = socket.getOutputStream()
        fun refuse(): Char? {
            try { out.write("NO\n".toByteArray()); out.flush() } catch (e: IOException) { /* gone */ }
            return null
        }
        val hello = try { readLine(socket).split(' ') } catch (e: IOException) { return null }
        if (hello.size != 4 || hello[0] != "HELLO2" || hello[1] !in listOf("C", "V") || hello[2] != fingerprint(token) || !hello[3].matches(Regex("[0-9a-f]{16,64}")))
            return refuse()
        val mine = nonce()
        out.write("CHAL $mine ${proof(token, "srv", hello[3], mine)}\n".toByteArray())
        out.flush()
        val auth = try { readLine(socket).split(' ') } catch (e: IOException) { return null }
        if (auth.size < 2 || auth[0] != "AUTH" || !MessageDigest.isEqual(auth[1].toByteArray(), proof(token, "cli", mine, hello[3]).toByteArray()))
            return refuse()
        out.write("OK $info\n".toByteArray())
        out.flush()
        socket.soTimeout = 0
        return hello[1][0]
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
