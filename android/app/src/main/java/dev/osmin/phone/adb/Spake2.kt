package dev.osmin.phone.adb

import java.math.BigInteger
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * SPAKE2 over edwards25519 exactly as BoringSSL does it (crypto/curve25519/spake25519.cc), because adbd's pairing
 * uses that code: the same points M and N, the same password scalar (with its "hack": multiples of the group order
 * added so that it is a multiple of eight), the same transcript hash. Two roles: Alice is the client, Bob the server.
 */
class Spake2(
    private val alice: Boolean,
    private val myName: ByteArray,
    private val theirName: ByteArray,
    private val random: SecureRandom = SecureRandom(),
) {
    private lateinit var privateKey: BigInteger
    private lateinit var passwordScalar: BigInteger
    private lateinit var passwordHash: ByteArray
    private lateinit var myMsg: ByteArray

    /** The 32-byte message for the other side. */
    fun generateMessage(password: ByteArray): ByteArray {
        val seed = ByteArray(64).also { random.nextBytes(it) }
        // reduced modulo L, times the cofactor eight
        privateKey = (Ed25519.fromLittleEndian(seed).mod(Ed25519.L)).shiftLeft(3)
        val p = Ed25519.multiply(Ed25519.BASE, privateKey)

        passwordHash = MessageDigest.getInstance("SHA-512").digest(password)
        var scalar = Ed25519.fromLittleEndian(passwordHash).mod(Ed25519.L)
        // Make it a multiple of eight by adding l, 2l and 4l where the low bits ask for it.
        var order = Ed25519.L
        for (bit in 0..2) {
            if (scalar.testBit(bit))
                scalar += order
            order = order.shiftLeft(1)
        }
        check((scalar.toInt() and 7) == 0)
        passwordScalar = scalar

        val mask = Ed25519.multiply(if (alice) M else N, passwordScalar)
        myMsg = Ed25519.encode(Ed25519.add(p, mask))
        return myMsg.copyOf()
    }

    /** The shared 64-byte key, or null when the other side's message is not a point of the curve. */
    fun processMessage(theirMsg: ByteArray): ByteArray? {
        if (theirMsg.size != 32)
            return null
        val qStar = Ed25519.decode(theirMsg) ?: return null
        val peersMask = Ed25519.multiply(if (alice) N else M, passwordScalar)
        val q = Ed25519.subtract(qStar, peersMask)
        val shared = Ed25519.encode(Ed25519.multiply(q, privateKey))

        val sha = MessageDigest.getInstance("SHA-512")
        fun update(data: ByteArray) {
            val length = ByteArray(8)
            for (i in 0 until 8)
                length[i] = ((data.size.toLong() shr (8 * i)) and 0xff).toByte()
            sha.update(length)
            sha.update(data)
        }
        if (alice) {
            update(myName)
            update(theirName)
            update(myMsg)
            update(theirMsg)
        } else {
            update(theirName)
            update(myName)
            update(theirMsg)
            update(myMsg)
        }
        update(shared)
        update(passwordHash)
        return sha.digest()
    }

    companion object {
        // The points N and M of BoringSSL's SPAKE2 (their encodings, from the comment above its tables).
        val N: Ed25519.Point = Ed25519.decode(hex("10e3df0ae37d8e7a99b5fe74b44672103dbddcbd06af680d71329a11693bc778"))!!
        val M: Ed25519.Point = Ed25519.decode(hex("5ada7e4bf6ddd9adb6626d32131c6b5c51a1e347a3478f53cfcf441b88eed12e"))!!

        // adb's names include the terminating NUL (it passes sizeof of the array).
        val CLIENT_NAME = "adb pair client\u0000".toByteArray(Charsets.ISO_8859_1)
        val SERVER_NAME = "adb pair server\u0000".toByteArray(Charsets.ISO_8859_1)

        fun client() = Spake2(true, CLIENT_NAME, SERVER_NAME)
        fun server() = Spake2(false, SERVER_NAME, CLIENT_NAME)

        fun hex(text: String): ByteArray = ByteArray(text.length / 2) { text.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }
}
