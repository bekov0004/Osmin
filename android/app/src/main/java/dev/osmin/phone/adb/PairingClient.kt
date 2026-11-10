package dev.osmin.phone.adb

import java.io.DataInputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer

/** What the pairing server tells about itself after the pairing: its guid. */
data class PeerInfo(val type: Int, val text: String)

class PairingException(message: String) : IOException(message)

/**
 * The client of adbd's pairing server (adb/pairing_connection). The phone shows a pairing code and an address; this
 * connects there with TLS 1.3, runs SPAKE2 with the code plus the TLS exporter as the password, and exchanges the
 * peer information encrypted with the key it makes: this side's public key goes in (so the phone trusts it from now
 * on) and the phone's guid comes back.
 */
class PairingClient(private val key: AdbKey) {
    fun pair(host: String, port: Int, code: String, timeoutMs: Int = 10_000): PeerInfo {
        val plain = Socket()
        try {
            plain.connect(InetSocketAddress(host, port), timeoutMs)
            plain.soTimeout = timeoutMs
            val socket = AdbTls.wrap(plain, key, server = false)
            socket.startHandshake()
            val exported = AdbTls.exportKeyingMaterial(socket)
            val spake = Spake2.client()
            val myMessage = spake.generateMessage(code.toByteArray() + exported)

            val out = socket.outputStream
            val input = DataInputStream(socket.inputStream)
            writePacket(out, TYPE_SPAKE2, myMessage)
            val theirMessage = readPacket(input, TYPE_SPAKE2)
            val keyMaterial = spake.processMessage(theirMessage) ?: throw PairingException("the phone's message is not valid")
            val cipher = PairingCipher(keyMaterial)

            val info = ByteArray(MAX_PEER_INFO)         // type (1 byte) and 8191 bytes of data, the rest zeros
            info[0] = TYPE_RSA_KEY.toByte()
            val text = key.publicKeyText().toByteArray()
            require(text.size < MAX_PEER_INFO) { "the key is too long" }
            text.copyInto(info, 1)
            writePacket(out, TYPE_PEER_INFO, cipher.encrypt(info))

            val theirInfo = cipher.decrypt(readPacket(input, TYPE_PEER_INFO))
                ?: throw PairingException("wrong pairing code")      // the key differs when the codes differ
            if (theirInfo.size != MAX_PEER_INFO)
                throw PairingException("the phone's information has the wrong size")
            val end = (1 until theirInfo.size).firstOrNull { theirInfo[it].toInt() == 0 } ?: theirInfo.size
            return PeerInfo(theirInfo[0].toInt(), String(theirInfo, 1, end - 1))
        } finally {
            try {
                plain.close()
            } catch (ignored: IOException) {
            }
        }
    }

    companion object {
        const val VERSION = 1
        const val TYPE_SPAKE2 = 0
        const val TYPE_PEER_INFO = 1
        const val TYPE_RSA_KEY = 0
        const val TYPE_DEVICE_GUID = 1
        const val MAX_PEER_INFO = 8192
        const val MAX_PAYLOAD = MAX_PEER_INFO * 2

        /** version (1 byte), type (1 byte), payload size (4 bytes, big-endian), the payload. */
        fun writePacket(out: java.io.OutputStream, type: Int, payload: ByteArray) {
            val header = ByteBuffer.allocate(6).put(VERSION.toByte()).put(type.toByte()).putInt(payload.size).array()
            out.write(header)
            out.write(payload)
            out.flush()
        }

        fun readPacket(input: DataInputStream, expectedType: Int): ByteArray {
            val header = ByteArray(6)
            input.readFully(header)
            val buffer = ByteBuffer.wrap(header)
            val version = buffer.get().toInt()
            val type = buffer.get().toInt()
            val size = buffer.int
            if (version != VERSION)
                throw PairingException("the phone speaks another version of the pairing ($version)")
            if (type != expectedType)
                throw PairingException("unexpected packet $type, wanted $expectedType")
            if (size <= 0 || size > MAX_PAYLOAD)
                throw PairingException("a packet of $size bytes")
            return ByteArray(size).also { input.readFully(it) }
        }
    }
}
