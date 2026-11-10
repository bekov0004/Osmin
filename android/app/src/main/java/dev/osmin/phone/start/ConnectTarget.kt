package dev.osmin.phone.start

import java.net.URLDecoder
import java.net.URLEncoder

/**
 * Where the computer listens for the phone, and the secret that proves it is the computer the user meant. It comes as
 * a link that Osmin on the computer shows (as a QR code and as text): osmin://connect?host=192.168.0.250&port=43211&token=...
 */
data class ConnectTarget(val host: String, val port: Int, val token: String) {
    fun toLink(): String = "osmin://connect?host=${enc(host)}&port=$port&token=${enc(token)}"

    companion object {
        private fun enc(text: String) = URLEncoder.encode(text, "UTF-8")

        /** @return null when the text is not a valid link of this kind */
        fun parse(link: String): ConnectTarget? {
            val text = link.trim()
            if (!text.startsWith("osmin://connect"))
                return null
            val query = text.substringAfter('?', "")
            val values = query.split('&').filter { it.contains('=') }.associate {
                URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('='), "UTF-8")
            }
            val host = values["host"]?.takeIf { it.isNotBlank() && it.all { c -> c.isLetterOrDigit() || c in ".-:" } } ?: return null
            val port = values["port"]?.toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
            val token = values["token"]?.takeIf { it.length in 8..128 && it.all { c -> c.isLetterOrDigit() } } ?: return null
            return ConnectTarget(host, port, token)
        }
    }
}

/** The shell command that starts the phone's server (see dev.osmin.phone.server.Server) and leaves it running. */
object StartCommand {
    private const val SERVER = "dev.osmin.phone.server.Server"

    /**
     * `setsid` and `nohup` keep it alive when the shell that started it ends; the output goes nowhere, and the trailing
     * `&` returns at once. Every part is a value this app made, and still quoted.
     */
    fun build(apkPath: String, target: ConnectTarget): String {
        require(apkPath.none { it == '\'' || it == '\n' }) { "a strange apk path" }
        return "CLASSPATH='$apkPath' setsid nohup app_process / $SERVER '${target.host}' ${target.port} '${target.token}' </dev/null >/dev/null 2>&1 &"
    }
}
