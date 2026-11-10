package dev.osmin.phone.adb

import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * What adb's pairing encrypts the peer information with (adb/pairing_auth/aes_128_gcm.cpp): an AES-128-GCM key from
 * HKDF-SHA256 of the SPAKE2 key (no salt, info "adb pairing_auth aes-128-gcm key"), a 12-byte nonce that starts with the
 * message counter as 8 little-endian bytes. Each direction counts its own messages from zero.
 */
class PairingCipher(keyMaterial: ByteArray) {
    private val key: SecretKeySpec
    private var encryptCount = 0L
    private var decryptCount = 0L

    init {
        key = SecretKeySpec(hkdfSha256(keyMaterial, "adb pairing_auth aes-128-gcm key".toByteArray(), 16), "AES")
    }

    private fun nonce(count: Long): ByteArray = ByteBuffer.allocate(12).order(ByteOrder.LITTLE_ENDIAN).putLong(count).array()

    fun encrypt(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonce(encryptCount)))
        val out = cipher.doFinal(plain)
        encryptCount++
        return out
    }

    /** @return the plain text, or null when it does not authenticate */
    fun decrypt(data: ByteArray): ByteArray? {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, nonce(decryptCount)))
        return try {
            cipher.doFinal(data).also { decryptCount++ }
        } catch (e: java.security.GeneralSecurityException) {
            null
        }
    }

    companion object {
        /** RFC 5869 with an empty salt (a salt of zeros, as HMAC pads it) and one block of output at most. */
        fun hkdfSha256(ikm: ByteArray, info: ByteArray, length: Int): ByteArray {
            require(length <= 32)
            val extract = Mac.getInstance("HmacSHA256")
            extract.init(SecretKeySpec(ByteArray(32), "HmacSHA256"))
            val prk = extract.doFinal(ikm)
            val expand = Mac.getInstance("HmacSHA256")
            expand.init(SecretKeySpec(prk, "HmacSHA256"))
            expand.update(info)
            expand.update(1)
            return expand.doFinal().copyOf(length)
        }
    }
}
