package dev.osmin.phone.server

import java.io.IOException
import java.net.Socket

/**
 * One connection of the phone to the computer: the control lines in, the replies out, the picture on its own
 * connection. Ends when the computer goes away or says `q`; what was changed on the phone is given back.
 */
class Session(
    private val endpoint: Endpoint,
    private val injector: Injector,
    private val source: VideoSource,
    private val screen: ScreenSize,
    private val info: String,
    private val bitRate: Int = 5_000_000,
    private val log: (String) -> Unit = {},
) {
    /** A size the picture is asked at: about 540 wide, both sides a multiple of 16 (what the encoder accepts). */
    private fun pictureSize(): ScreenSize {
        val width = Math.round(minOf(540, screen.width) / 16f) * 16
        val height = Math.round(screen.height.toFloat() * width / screen.width / 16f) * 16
        return ScreenSize(width, height)
    }

    fun run() {
        var control: Socket? = null
        var video: Socket? = null
        var pump: VideoPump? = null
        var dark = false
        try {
            control = Link.open(endpoint, 'C', "${screen.width}x${screen.height} $info")
            video = Link.open(endpoint, 'V', "${screen.width}x${screen.height} $info")
            val size = pictureSize()
            pump = VideoPump(source, video.getOutputStream(), size.width, size.height, bitRate, onGiveUp = { closeQuietly(control) })
            pump.start()

            val out = control.getOutputStream()
            fun reply(line: String) {
                synchronized(out) {
                    out.write("$line\n".toByteArray())
                    out.flush()
                }
            }
            while (true) {
                val line = try {
                    Link.readLine(control)
                } catch (e: IOException) {
                    break
                }
                when (val command = CommandParser.parse(line) ?: continue) {
                    is Command.Down -> injector.touch(TouchAction.DOWN, command.x, command.y)
                    is Command.Move -> injector.touch(TouchAction.MOVE, command.x, command.y)
                    is Command.Up -> injector.touch(TouchAction.UP, command.x, command.y)
                    is Command.Key -> injector.key(command.code)
                    is Command.Text -> injector.text(command.text)
                    is Command.Awake -> injector.keepAwake(command.on)
                    is Command.WakeIfAsleep -> injector.wakeIfAsleep()
                    is Command.Video -> pump.change(command.width, command.height, command.bitRate)
                    is Command.Panel -> {
                        val error = injector.panel(command.mode)
                        if (error == null && command.mode == 0) dark = true
                        if (command.mode != 0) dark = false
                        reply(if (error == null) "POWER OK ${command.mode}" else "POWER ERR $error")
                    }
                    is Command.Quit -> break
                }
            }
        } catch (e: Exception) {
            log("session ended: ${e.message}")
        } finally {
            pump?.stop()
            // The computer is gone while the screen was dark: put the phone to sleep, so nothing lights up by itself.
            if (dark) {
                try {
                    injector.key(223)         // KEYCODE_SLEEP
                } catch (ignored: Exception) {
                }
                injector.panel(3)
            }
            injector.close()
            closeQuietly(control)
            closeQuietly(video)
        }
    }

    private fun closeQuietly(socket: Socket?) {
        try {
            socket?.close()
        } catch (ignored: IOException) {
        }
    }
}
