package dev.osmin.phone.server

import java.io.File
import java.io.InputStream

/** The phone's own `screenrecord`: an H.264 stream of the screen on its standard output. */
class ScreenrecordSource : VideoSource {
    override fun start(width: Int, height: Int, bitRate: Int): VideoProcess {
        val builder = ProcessBuilder("screenrecord", "--output-format=h264", "--size=${width}x$height", "--bit-rate=$bitRate", "-")
        builder.redirectError(ProcessBuilder.Redirect.appendTo(File("/dev/null")))
        val process = builder.start()
        return object : VideoProcess {
            override val stream: InputStream = process.inputStream
            override fun stop() {
                process.destroy()
            }
            override fun waitFor(): Int = process.waitFor()
        }
    }
}
