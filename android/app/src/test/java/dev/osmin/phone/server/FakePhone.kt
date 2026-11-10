package dev.osmin.phone.server

import java.io.File
import java.io.InputStream

/**
 * A stand-in for the phone, run on this computer by the Osmin tests instead of `app_process`: the real server code
 * (Session, VideoPump, the protocol), with ffmpeg making the picture and the calls written to a file instead of
 * going to Android. Usage: FakePhone <host> <port> <token> (environment FAKE_LOG: where the calls are written).
 */
object FakePhone {
    private class LoggingInjector(private val log: File) : Injector {
        private fun write(line: String) = synchronized(this) { log.appendText("$line\n") }
        override fun touch(action: TouchAction, x: Float, y: Float) = write("touch ${action.name.lowercase()} ${x.toInt()} ${y.toInt()}")
        override fun key(code: Int) = write("key $code")
        override fun text(text: String) = write("text $text")
        override fun panel(mode: Int): String? { write("panel $mode"); return null }
        override fun keepAwake(on: Boolean) = write("awake $on")
        override fun wakeIfAsleep() = write("wake")
        override fun shell(command: String) = write("shell $command")
        override fun close() = write("close")
    }

    private class FfmpegSource : VideoSource {
        override fun start(width: Int, height: Int, bitRate: Int): VideoProcess {
            val process = ProcessBuilder("ffmpeg", "-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi",
                "-i", "testsrc2=size=${width}x$height:rate=15", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
                "-pix_fmt", "yuv420p", "-g", "15", "-bsf:v", "h264_mp4toannexb", "-f", "h264", "-")
                .redirectError(ProcessBuilder.Redirect.appendTo(File("/dev/null"))).start()
            return object : VideoProcess {
                override val stream: InputStream = process.inputStream
                override fun stop() { process.destroy() }
                override fun waitFor(): Int = process.waitFor()
            }
        }
    }

    /**
     * FakePhone <host> <port> <token> [stay]. With `stay` it behaves like the app's server: when a session ends, it
     * searches the network FAKE_OWN_IP is in (the phone's "own address", say 192.168.0.15) for the port and connects again.
     */
    @JvmStatic
    fun main(args: Array<String>) {
        val log = File(System.getenv("FAKE_LOG") ?: "/tmp/fakephone.log")
        fun session(at: Endpoint, timeout: Int = Link.CONNECT_TIMEOUT_MS) =
            Session(at, LoggingInjector(log), FfmpegSource(), ScreenSize(1080, 2400), "36 FAKE_PHONE", connectTimeoutMs = timeout, silenceMs = 9000)
        val endpoint = Endpoint(args[0], args[1].toInt(), args[2])
        if (args.getOrNull(3) == "stay") {
            val own = System.getenv("FAKE_OWN_IP") ?: "192.168.0.15"
            Roamer(endpoint.port, endpoint.token, endpoint.host,
                find = { Lan.open(Lan.candidates(listOf(LocalNet("wlan0", own, 24)), emptyList(), null), endpoint.port) },
                sessionFor = { session(it, 1_500)::run },
                sleep = { Thread.sleep(minOf(it, 2_000)) },
                log = { log.appendText("$it\n") }).run()
        } else {
            session(endpoint).run()
        }
        System.exit(0)
    }
}
