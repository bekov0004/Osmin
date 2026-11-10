package dev.osmin.phone.adb

import java.io.ByteArrayInputStream
import java.io.File
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.interfaces.RSAPublicKey
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * The RSA key that makes this app a host adbd trusts: it is paired once (the phone keeps the public key) and then
 * answers the TLS handshake with a certificate made from it. Stored in the app's private folder.
 */
class AdbKey(val keyPair: KeyPair, val name: String) {
    val publicKey: RSAPublicKey get() = keyPair.public as RSAPublicKey

    /** What adb calls the public key: the Android RSA key structure in base64, a space and a name. */
    fun publicKeyText(): String = Base64.getEncoder().encodeToString(androidPublicKey(publicKey)) + " " + name

    /** A self-signed certificate of the key, the one the TLS handshake of adb uses. */
    val certificate: X509Certificate by lazy {
        CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(Der.selfSignedCertificate(keyPair))) as X509Certificate
    }

    fun save(dir: File) {
        dir.mkdirs()
        File(dir, "private.pk8").writeBytes(keyPair.private.encoded)
        File(dir, "public.x509").writeBytes(keyPair.public.encoded)
        File(dir, "name.txt").writeText(name)
    }

    companion object {
        fun generate(name: String): AdbKey {
            val generator = KeyPairGenerator.getInstance("RSA")
            generator.initialize(2048)
            return AdbKey(generator.generateKeyPair(), name)
        }

        fun load(dir: File): AdbKey? {
            val private = File(dir, "private.pk8")
            val public = File(dir, "public.x509")
            if (!private.exists() || !public.exists())
                return null
            val factory = KeyFactory.getInstance("RSA")
            val pair = KeyPair(factory.generatePublic(X509EncodedKeySpec(public.readBytes())), factory.generatePrivate(PKCS8EncodedKeySpec(private.readBytes())))
            return AdbKey(pair, File(dir, "name.txt").takeIf { it.exists() }?.readText() ?: "osmin@phone")
        }

        fun loadOrCreate(dir: File, name: String): AdbKey = load(dir) ?: generate(name).also { it.save(dir) }

        /** The key of an `adb keygen` file (PKCS#8 in PEM), for tests. */
        fun fromPem(pem: String, name: String): AdbKey {
            val der = Base64.getMimeDecoder().decode(pem.lines().filter { !it.startsWith("-----") }.joinToString(""))
            val factory = KeyFactory.getInstance("RSA")
            val private = factory.generatePrivate(PKCS8EncodedKeySpec(der)) as java.security.interfaces.RSAPrivateCrtKey
            val public = factory.generatePublic(java.security.spec.RSAPublicKeySpec(private.modulus, private.publicExponent))
            return AdbKey(KeyPair(public, private), name)
        }

        /**
         * libcrypto_utils' android_pubkey_encode: {uint32 words = 64, uint32 n0inv, modulus[256] little-endian,
         * rr[256] little-endian (2^4096 mod n), uint32 exponent}, all little-endian.
         */
        fun androidPublicKey(key: RSAPublicKey): ByteArray {
            val n = key.modulus
            val words = 64
            val out = java.nio.ByteBuffer.allocate(4 + 4 + 256 + 256 + 4).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            val two32 = BigInteger.ONE.shiftLeft(32)
            val n0inv = n.mod(two32).modInverse(two32).negate().mod(two32)
            out.putInt(words)
            out.putInt(n0inv.toLong().toInt())
            out.put(Ed25519.littleEndian(n, 256))
            out.put(Ed25519.littleEndian(BigInteger.ONE.shiftLeft(2048 * 2).mod(n), 256))
            out.putInt(key.publicExponent.toInt())
            return out.array()
        }
    }
}

/** The little of ASN.1 DER a certificate needs. */
object Der {
    private fun length(n: Int): ByteArray = when {
        n < 0x80 -> byteArrayOf(n.toByte())
        n < 0x100 -> byteArrayOf(0x81.toByte(), n.toByte())
        else -> byteArrayOf(0x82.toByte(), (n shr 8).toByte(), n.toByte())
    }

    fun tlv(tag: Int, content: ByteArray): ByteArray = byteArrayOf(tag.toByte()) + length(content.size) + content

    fun sequence(vararg parts: ByteArray) = tlv(0x30, parts.fold(ByteArray(0)) { a, b -> a + b })

    fun integer(value: BigInteger) = tlv(0x02, value.toByteArray())

    private fun oid(vararg arcs: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        out.write(arcs[0] * 40 + arcs[1])
        for (arc in arcs.drop(2)) {
            val groups = mutableListOf(arc and 0x7f)
            var rest = arc shr 7
            while (rest > 0) { groups += (rest and 0x7f) or 0x80; rest = rest shr 7 }
            groups.reversed().forEach { out.write(it) }
        }
        return tlv(0x06, out.toByteArray())
    }

    private fun name(common: String) = sequence(tlv(0x31, sequence(oid(2, 5, 4, 3), tlv(0x0c, common.toByteArray()))))

    private fun time(text: String) = tlv(0x17, text.toByteArray())

    /** A version 3 certificate, serial 1, subject and issuer "CN=00", valid for decades, signed with SHA-256 and RSA. */
    fun selfSignedCertificate(pair: KeyPair): ByteArray {
        val algorithm = sequence(oid(1, 2, 840, 113549, 1, 1, 11), tlv(0x05, ByteArray(0)))
        val tbs = sequence(
            tlv(0xA0, integer(BigInteger.valueOf(2))),
            integer(BigInteger.ONE),
            algorithm,
            name("00"),
            sequence(time("200101000000Z"), time("491231235959Z")),
            name("00"),
            pair.public.encoded,
        )
        val signature = Signature.getInstance("SHA256withRSA").run {
            initSign(pair.private)
            update(tbs)
            sign()
        }
        return sequence(tbs, algorithm, tlv(0x03, byteArrayOf(0) + signature))
    }
}
