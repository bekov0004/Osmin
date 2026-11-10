package dev.osmin.phone.server

import android.os.Build
import android.system.Os
import java.io.File

/**
 * The process that runs on the phone with the rights of adb's shell:
 *
 *     CLASSPATH=<this apk> app_process / dev.osmin.phone.server.Server <host> <port> <token> [stay]
 *
 * It dials the computer (host and port come from the QR code) and serves the picture and the control until the
 * computer leaves. With `stay` it keeps going: when the session ends, or the network changes, it looks for the computer
 * in the network the phone is in now (see Roamer) and connects again. It needs adb only to be started; after that it
 * stays, also in a network where Wireless debugging is not available (the phone's own hotspot).
 */
object Server {
    private const val PID_FILE = "/data/local/tmp/osmin-server.pid"

    @JvmStatic
    fun main(args: Array<String>) {
        if (args.size < 3) {
            System.err.println("usage: Server <host> <port> <token> [stay]")
            Runtime.getRuntime().halt(2)
        }
        val endpoint = Endpoint(args[0], args[1].toInt(), args[2])
        val model = Build.MODEL.replace(' ', '_')
        val log = { text: String -> System.err.println(text) }
        fun session(at: Endpoint, connectTimeoutMs: Int = Link.CONNECT_TIMEOUT_MS) =
            Session(at, AndroidInjector(), ScreenrecordSource(), readScreenSize(), "${Build.VERSION.SDK_INT} $model", log = log, connectTimeoutMs = connectTimeoutMs)

        if (args.getOrNull(3) == "stay") {
            replaceOlderServer()
            val apk = System.getenv("CLASSPATH").orEmpty().split(':').firstOrNull().orEmpty()
            Roamer(endpoint.port, endpoint.token, endpoint.host,
                find = { Lan.open(Lan.candidates(Lan.localNets(), Lan.readArp(), null), endpoint.port) },
                sessionFor = { session(it, 2_000)::run },
                // an app that was removed or updated takes its apk with it: this server is then the old one
                keepGoing = { apk.isEmpty() || File(apk).exists() },
                log = log).run()
        } else {
            session(endpoint).run()
        }
        // Leave at once: shutting the virtual machine down normally crashes once the display library is loaded.
        System.out.flush()
        Runtime.getRuntime().halt(0)
    }

    /** Only one server stays: a newer one takes over from the one that is still running (same user, the shell). */
    private fun replaceOlderServer() {
        try {
            val file = File(PID_FILE)
            val old = file.takeIf { it.exists() }?.readText()?.trim()?.toIntOrNull()
            if (old != null && old != Os.getpid() && File("/proc/$old/cmdline").readText().contains("app_process"))
                Os.kill(old, 9)
        } catch (e: Exception) {
            // not there, or not ours to end
        }
        try {
            File(PID_FILE).writeText("${Os.getpid()}\n")
        } catch (e: Exception) {
            // the pid file is only a convenience
        }
    }

    private fun readScreenSize(): ScreenSize {
        val process = ProcessBuilder("wm", "size").redirectErrorStream(true).start()
        val text = process.inputStream.bufferedReader().readText()
        process.waitFor()
        return ScreenSize.parse(text) ?: ScreenSize(1080, 2400)
    }
}
