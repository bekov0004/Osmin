package dev.osmin.phone.server

import java.io.InputStream
import java.io.OutputStream

/** A running picture source: the phone's `screenrecord`, or a fake one in tests. */
interface VideoProcess {
    val stream: InputStream
    fun stop()
    fun waitFor(): Int
}

interface VideoSource {
    fun start(width: Int, height: Int, bitRate: Int): VideoProcess
}

/**
 * Sends the phone's screen as an H.264 stream. screenrecord stops by itself after three minutes and its encoder
 * sometimes refuses right while the screen changes state: both are answered by starting it again (the decoder on
 * the computer takes a stream that begins again). Gives up after [maxTries] starts in a row that gave no picture.
 */
class VideoPump(
    private val source: VideoSource,
    private val out: OutputStream,
    private var width: Int,
    private var height: Int,
    private var bitRate: Int,
    private val retryDelayMs: Long = 1200,
    private val restartDelayMs: Long = 800,
    private val maxTries: Int = 6,
    private val onGiveUp: () -> Unit = {},
) {
    @Volatile private var stopped = false
    @Volatile private var current: VideoProcess? = null
    @Volatile private var restart = false
    private var thread: Thread? = null
    private val lock = Any()

    fun start() {
        thread = Thread(::run, "osmin-video").also { it.isDaemon = true; it.start() }
    }

    /** A new size or quality: the picture restarts with it. */
    fun change(width: Int, height: Int, bitRate: Int) {
        // Under the lock, so a change that comes while a run is just starting is not lost.
        synchronized(lock) {
            this.width = width
            this.height = height
            this.bitRate = bitRate
            restart = true
            current?.stop()
        }
    }

    fun stop() {
        synchronized(lock) {
            stopped = true
            current?.stop()
        }
    }

    fun join(timeoutMs: Long) {
        thread?.join(timeoutMs)
    }

    private fun run() {
        var failures = 0
        val buffer = ByteArray(32 * 1024)
        while (!stopped) {
            val (w, h, rate) = synchronized(lock) { Triple(width, height, bitRate) }
            val process = try {
                source.start(w, h, rate)
            } catch (e: Exception) {
                failures++
                if (failures > maxTries) break
                sleep(retryDelayMs)
                continue
            }
            synchronized(lock) {
                current = process
                // A change or a stop that came before the run was known to the pump ends it at once.
                if (restart || stopped)
                    process.stop()
            }
            var sent = 0L
            try {
                while (!stopped) {
                    val n = process.stream.read(buffer)
                    if (n < 0) break
                    out.write(buffer, 0, n)
                    out.flush()
                    sent += n
                }
            } catch (e: java.io.IOException) {
                // either the picture's source ended oddly or the computer went away; the loop below decides
                if (isBroken(e)) { process.stop(); stopped = true }
            }
            process.stop()
            process.waitFor()
            synchronized(lock) {
                current = null
            }
            if (stopped) break
            if (restart) {
                synchronized(lock) { restart = false }
                failures = 0
                continue
            }
            if (sent == 0L) {
                failures++
                if (failures > maxTries) {
                    onGiveUp()
                    break
                }
                sleep(retryDelayMs)
            } else {
                failures = 0
                sleep(restartDelayMs)
            }
        }
    }

    /** A write that fails means the computer is gone (a failed read of the source is not that). */
    private fun isBroken(e: java.io.IOException): Boolean = e is java.net.SocketException

    private fun sleep(ms: Long) {
        try {
            Thread.sleep(ms)
        } catch (e: InterruptedException) {
            stopped = true
        }
    }
}
