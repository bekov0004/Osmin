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
