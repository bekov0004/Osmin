package dev.osmin.phone.server

/** One line of the control channel, as the computer sends it. */
sealed interface Command {
    data class Down(val x: Float, val y: Float) : Command
    data class Move(val x: Float, val y: Float) : Command
    data class Up(val x: Float, val y: Float) : Command
    data class Key(val code: Int) : Command
    data class Text(val text: String) : Command

    /** The panel of the screen: 0 dark (kept dark), 2 lit, 3 stop keeping it dark. */
    data class Panel(val mode: Int) : Command
    data class Awake(val on: Boolean) : Command
    data object WakeIfAsleep : Command

    /** Ask for a picture of another size or quality (the video restarts). */
    data class Video(val width: Int, val height: Int, val bitRate: Int) : Command
    data object Quit : Command
}

object CommandParser {
    /**
     * `d x y` `m x y` `u x y` (a finger down, moving, up; pixels of the screen), `k code` (a key), `t text`
     * (type ASCII text), `p mode`, `w 1|0`, `z`, `v WxH bitrate`, `q`. Anything else is ignored (null).
     */
    fun parse(line: String): Command? {
        if (line.isEmpty())
            return null
        val rest = if (line.length > 2) line.substring(2) else ""
        return try {
            when (line[0]) {
                'd' -> point(rest)?.let { Command.Down(it.first, it.second) }
                'm' -> point(rest)?.let { Command.Move(it.first, it.second) }
                'u' -> point(rest)?.let { Command.Up(it.first, it.second) }
                'k' -> Command.Key(rest.trim().toInt())
                't' -> Command.Text(rest)
                'p' -> Command.Panel(rest.trim().toInt())
                'w' -> Command.Awake(rest.trim() == "1")
                'z' -> Command.WakeIfAsleep
                'q' -> Command.Quit
                'v' -> video(rest)
                else -> null
            }
        } catch (e: NumberFormatException) {
            null
        }
    }

    private fun point(text: String): Pair<Float, Float>? {
        val parts = text.trim().split(' ')
        if (parts.size < 2)
            return null
        return Pair(parts[0].toFloat(), parts[1].toFloat())
    }

    private fun video(text: String): Command.Video? {
        val parts = text.trim().split(' ')
        val size = parts.getOrNull(0)?.split('x') ?: return null
        if (size.size != 2 || parts.size < 2)
            return null
        return Command.Video(size[0].toInt(), size[1].toInt(), parts[1].toInt())
    }
}
