package dev.osmin.phone.adb

import java.io.DataInputStream
import java.io.IOException
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

object AdbCommand {
    const val CNXN = 0x4e584e43
    const val OPEN = 0x4e45504f
    const val OKAY = 0x59414b4f
    const val CLSE = 0x45534c43
    const val WRTE = 0x45545257
    const val STLS = 0x534c5453
    const val AUTH = 0x48545541
}

/** One adb message: a 24-byte header (little-endian: command, arg0, arg1, data length, data checksum, magic) and the data. */
class AdbMessage(val command: Int, val arg0: Int, val arg1: Int, val data: ByteArray = ByteArray(0)) {
    override fun toString() = "AdbMessage(${commandName(command)}, $arg0, $arg1, ${data.size} bytes)"

    companion object {
        const val VERSION = 0x01000001          // the version that skips checksums
        const val STLS_VERSION = 0x01000000
        const val MAX_DATA = 1024 * 1024

        fun commandName(command: Int): String = String(ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(command).array())

        fun write(out: OutputStream, message: AdbMessage) {
            var sum = 0
            for (b in message.data)
                sum += b.toInt() and 0xff
            val header = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN)
                .putInt(message.command).putInt(message.arg0).putInt(message.arg1)
                .putInt(message.data.size).putInt(sum).putInt(message.command.inv())
            out.write(header.array())
            if (message.data.isNotEmpty())
                out.write(message.data)
            out.flush()
        }

        fun read(input: DataInputStream): AdbMessage {
            val header = ByteArray(24)
            input.readFully(header)
            val buffer = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
            val command = buffer.int
            val arg0 = buffer.int
            val arg1 = buffer.int
            val length = buffer.int
            buffer.int          // the checksum is not used from version 0x01000001 on
            val magic = buffer.int
            if (magic != command.inv())
                throw IOException("not an adb message")
            if (length < 0 || length > MAX_DATA)
                throw IOException("an adb message of $length bytes")
            return AdbMessage(command, arg0, arg1, ByteArray(length).also { input.readFully(it) })
        }
    }
}
