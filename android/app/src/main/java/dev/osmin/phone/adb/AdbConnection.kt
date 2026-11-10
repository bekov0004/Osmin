package dev.osmin.phone.adb

import java.io.DataInputStream
import java.io.IOException
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import javax.net.ssl.SSLSocket

/**
 * A connection to adbd's wireless debugging port (the one published as _adb-tls-connect): our CNXN, adbd's STLS, ours,
 * TLS 1.3 with the certificate of the paired key, adbd's CNXN. After that, streams: [shell] runs a command.
 */
class AdbConnection(private val key: AdbKey) : AutoCloseable {
    private var plain: Socket? = null
    private var socket: SSLSocket? = null
    private var input: DataInputStream? = null
    private var output: OutputStream? = null
    private var nextId = 1

    /** adbd's banner (device::features=...) once connected. */
    var banner: String = ""
        private set

    fun connect(host: String, port: Int, timeoutMs: Int = 10_000) {
        val raw = Socket()
        plain = raw
        raw.connect(InetSocketAddress(host, port), timeoutMs)
        raw.soTimeout = timeoutMs
        raw.tcpNoDelay = true
        val rawIn = DataInputStream(raw.getInputStream())
        val rawOut = raw.getOutputStream()

        AdbMessage.write(rawOut, AdbMessage(AdbCommand.CNXN, AdbMessage.VERSION, AdbMessage.MAX_DATA, "host::".toByteArray()))
        val stls = AdbMessage.read(rawIn)
        if (stls.command != AdbCommand.STLS)
            throw IOException("the phone did not ask for TLS (${AdbMessage.commandName(stls.command)})")
        AdbMessage.write(rawOut, AdbMessage(AdbCommand.STLS, AdbMessage.STLS_VERSION, 0))

        val tls = AdbTls.wrap(raw, key, server = false)
        socket = tls
        tls.startHandshake()
        input = DataInputStream(tls.inputStream)
        output = tls.outputStream

        val cnxn = AdbMessage.read(input!!)
        if (cnxn.command != AdbCommand.CNXN)
            throw IOException("the phone did not answer with its banner (${AdbMessage.commandName(cnxn.command)})")
        banner = String(cnxn.data).trimEnd('\u0000')
    }

    /**
     * Runs `command` in the phone's shell and gives what it printed (standard output and error together).
     * Returns when the shell ends, so a command that starts something in the background should not wait for it.
     */
    fun shell(command: String): String {
        val din = input ?: throw IOException("not connected")
        val out = output ?: throw IOException("not connected")
        val local = nextId++
        AdbMessage.write(out, AdbMessage(AdbCommand.OPEN, local, 0, "shell:$command\u0000".toByteArray()))
        var remote = 0
        val result = java.io.ByteArrayOutputStream()
        while (true) {
            val message = AdbMessage.read(din)
            when (message.command) {
                AdbCommand.OKAY -> if (message.arg1 == local) remote = message.arg0
                AdbCommand.WRTE -> {
                    result.write(message.data)
                    AdbMessage.write(out, AdbMessage(AdbCommand.OKAY, local, message.arg0))
                }
                AdbCommand.CLSE -> {
                    if (message.arg1 == local || message.arg1 == 0) {
                        if (remote != 0)
                            AdbMessage.write(out, AdbMessage(AdbCommand.CLSE, local, remote))
                        return result.toString(Charsets.UTF_8.name())
                    }
                }
                else -> {}
            }
        }
    }

    override fun close() {
        try {
            socket?.close()
        } catch (ignored: IOException) {
        }
        try {
            plain?.close()
        } catch (ignored: IOException) {
        }
    }
}
