package dev.osmin.phone.server

data class ScreenSize(val width: Int, val height: Int) {
    companion object {
        /** The output of `wm size`: "Physical size: 1080x2400" (and "Override size:" when it was changed). */
        fun parse(text: String): ScreenSize? {
            val match = Regex("Override size:\\s*(\\d+)x(\\d+)").find(text)
                ?: Regex("Physical size:\\s*(\\d+)x(\\d+)").find(text)
                ?: return null
            return ScreenSize(match.groupValues[1].toInt(), match.groupValues[2].toInt())
        }
    }
}
