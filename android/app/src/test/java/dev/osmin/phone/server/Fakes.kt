package dev.osmin.phone.server

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class FakeInjector : Injector {
    val calls = CopyOnWriteArrayList<String>()
    var panelError: String? = null
    val closed = CountDownLatch(1)

    override fun touch(action: TouchAction, x: Float, y: Float) { calls += "touch ${action.name.lowercase()} $x $y" }
    override fun key(code: Int) { calls += "key $code" }
    override fun text(text: String) { calls += "text $text" }
    override fun panel(mode: Int): String? { calls += "panel $mode"; return if (mode == 0) panelError else null }
    override fun keepAwake(on: Boolean) { calls += "awake $on" }
    override fun wakeIfAsleep() { calls += "wake" }
    override fun shell(command: String) { calls += "shell $command" }
    override fun close() { calls += "close"; closed.countDown() }

    fun await(vararg expected: String, timeoutMs: Long = 3000) {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            if (calls.toList().containsAll(expected.toList())) return
            Thread.sleep(10)
        }
        throw AssertionError("expected $expected in $calls")
    }
}

/** A source of scripted runs: each start() takes the next script (bytes it gives, then it ends). */
class FakeSource(private vararg val runs: ByteArray?) : VideoSource {
    val starts = CopyOnWriteArrayList<String>()
    private var next = 0

    @Synchronized override fun start(width: Int, height: Int, bitRate: Int): VideoProcess {
        starts += "${width}x$height@$bitRate"
        val data = runs.getOrNull(next++) ?: ByteArray(0)
        val stream: InputStream = ByteArrayInputStream(data)
        return object : VideoProcess {
            override val stream: InputStream = stream
            override fun stop() {}
            override fun waitFor() = 0
        }
    }
}

/** A source that gives bytes until stopped (like a real screenrecord does). */
class EndlessSource : VideoSource {
    val starts = CopyOnWriteArrayList<String>()

    override fun start(width: Int, height: Int, bitRate: Int): VideoProcess {
        starts += "${width}x$height@$bitRate"
        val out = PipedOutputStream()
        val input = PipedInputStream(out, 64 * 1024)
        val thread = Thread {
            try {
                var n = 0
                while (true) { out.write(byteArrayOf(1, 2, 3, (n++).toByte())); Thread.sleep(5) }
            } catch (e: Exception) { /* stopped */ }
        }.also { it.isDaemon = true; it.start() }
        return object : VideoProcess {
            override val stream: InputStream = input
            override fun stop() { thread.interrupt(); try { out.close() } catch (e: Exception) {} }
            override fun waitFor() = 0
        }
    }
}

fun CountDownLatch.waitFor(ms: Long = 3000) = await(ms, TimeUnit.MILLISECONDS)

/** The line of a socket, up to the newline (nothing is read past it). */
fun readLineOf(socket: java.net.Socket): String {
    val b = java.io.ByteArrayOutputStream()
    val input = socket.getInputStream()
    while (true) { val c = input.read(); if (c < 0 || c == '\n'.code) break; b.write(c) }
    return b.toString()
}

/** What the computer learns from a phone that proved itself. */
data class Greeting(val role: Char, val info: String)

/**
 * The computer's side of the link (see Link): the challenge, the check of the phone's proof, and OK.
 * @return the phone's role and info, or null when the phone did not know the secret (it is answered NO)
 */
fun computerGreets(socket: java.net.Socket, token: String): Greeting? {
    val hello = readLineOf(socket).split(' ')
    val out = socket.getOutputStream()
    if (hello.size != 4 || hello[0] != "HELLO2" || hello[2] != Link.fingerprint(token)) {
        out.write("NO\n".toByteArray()); out.flush()
        return null
    }
    val nonce = "c0ffee00c0ffee00c0ffee00c0ffee00"
    out.write("CHAL $nonce ${Link.proof(token, "srv", hello[3], nonce)}\n".toByteArray()); out.flush()
    val auth = readLineOf(socket)
    val parts = auth.split(' ', limit = 3)
    if (parts.size < 3 || parts[0] != "AUTH" || parts[1] != Link.proof(token, "cli", nonce, hello[3])) {
        out.write("NO\n".toByteArray()); out.flush()
        return null
    }
    out.write("OK\n".toByteArray()); out.flush()
    return Greeting(hello[1][0], parts[2])
}
