package dev.osmin.phone.server

import android.os.Build

/**
 * The process that runs on the phone with the rights of adb's shell:
 *
 *     CLASSPATH=<this apk> app_process / dev.osmin.phone.server.Server <host> <port> <token>
 *
 * It dials the computer (host and port come from the QR code) and serves the picture and the control until the
 * computer leaves.
 */
object Server {
    @JvmStatic
    fun main(args: Array<String>) {
        if (args.size < 3) {
            System.err.println("usage: Server <host> <port> <token>")
            Runtime.getRuntime().halt(2)
        }
        val endpoint = Endpoint(args[0], args[1].toInt(), args[2])
        val screen = readScreenSize()
        val model = Build.MODEL.replace(' ', '_')
        val session = Session(endpoint, AndroidInjector(), ScreenrecordSource(), screen, "${Build.VERSION.SDK_INT} $model",
            log = { System.err.println(it) })
        session.run()
        // Leave at once: shutting the virtual machine down normally crashes once the display library is loaded.
        System.out.flush()
        Runtime.getRuntime().halt(0)
    }

    private fun readScreenSize(): ScreenSize {
        val process = ProcessBuilder("wm", "size").redirectErrorStream(true).start()
        val text = process.inputStream.bufferedReader().readText()
        process.waitFor()
        return ScreenSize.parse(text) ?: ScreenSize(1080, 2400)
    }
}
