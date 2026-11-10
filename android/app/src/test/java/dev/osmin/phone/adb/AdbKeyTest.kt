package dev.osmin.phone.adb

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

class AdbKeyTest {
    /** A key made by the real `adb keygen` (a folder in /tmp/adbkeys.path), or the tests that need it are skipped. */
    private fun realKey(): Pair<AdbKey, String>? {
        val folder = File("/tmp/adbkeys.path").takeIf { it.exists() }?.readText()?.trim() ?: return null
        val pem = File(folder, "testkey").takeIf { it.exists() }?.readText() ?: return null
        val pub = File(folder, "testkey.pub").takeIf { it.exists() }?.readText() ?: return null
        return AdbKey.fromPem(pem, pub.substringAfter(' ')) to pub
    }

    @Test fun thePublicKeyIsWhatAdbWrites() {
        val (key, pub) = realKey().also { assumeTrue("no adb keygen key", it != null) }!!
        assertEquals(pub, key.publicKeyText())
    }

    @Test fun aNewKeyHasTheRightShape() {
        val key = AdbKey.generate("user@host")
        val raw = java.util.Base64.getDecoder().decode(key.publicKeyText().substringBefore(' '))
        assertEquals(524, raw.size)
        assertEquals(64, java.nio.ByteBuffer.wrap(raw).order(java.nio.ByteOrder.LITTLE_ENDIAN).int)
        assertTrue(key.publicKeyText().endsWith(" user@host"))
    }

    @Test fun theCertificateIsValidAndSelfSigned() {
        val key = AdbKey.generate("a@b")
        val cert = key.certificate
        cert.verify(key.publicKey)                   // signed by the key itself
        assertEquals("CN=00", cert.subjectX500Principal.name)
        assertEquals(key.publicKey, cert.publicKey)
        assertEquals(3, cert.version)
    }

    @Test fun aKeyCanBeSavedAndLoaded() {
        val dir = createTempDir("adbkey")
        try {
            val key = AdbKey.loadOrCreate(dir, "x@y")
            val again = AdbKey.load(dir)
            assertNotNull(again)
            assertEquals(key.publicKeyText(), again!!.publicKeyText())
        } finally {
            dir.deleteRecursively()
        }
    }
}
