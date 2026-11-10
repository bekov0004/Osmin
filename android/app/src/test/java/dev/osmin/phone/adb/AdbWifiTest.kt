package dev.osmin.phone.adb

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.IOException

/** The client against the fake adbd: pairing, then the TLS connection and a shell command. */
class AdbWifiTest {
    private lateinit var fake: FakeAdbd
    private val key = AdbKey.generate("tester@osmin")

    @Before fun setUp() {
        fake = FakeAdbd()
        fake.shellOutput = { "ran: $it\n" }
        fake.start()
    }

    @After fun tearDown() = fake.stop()

    @Test fun pairingGivesTheGuidAndTrustsTheKey() {
        val info = PairingClient(key).pair("127.0.0.1", fake.pairingPort, "123456")
        assertEquals(PairingClient.TYPE_DEVICE_GUID, info.type)
        assertEquals("adb-FAKE0001", info.text)
        assertEquals(listOf(key.publicKey.modulus), fake.paired.toList())
    }

    @Test fun aWrongCodeIsRefused() {
        try {
            PairingClient(key).pair("127.0.0.1", fake.pairingPort, "999999")
            fail("paired with a wrong code")
        } catch (e: IOException) {
            // PairingException or the connection closed by the other side: both mean "no"
        }
        assertTrue(fake.paired.isEmpty())
    }

    @Test fun aPairedKeyConnectsAndRunsACommand() {
        PairingClient(key).pair("127.0.0.1", fake.pairingPort, "123456")
        AdbConnection(key).use { connection ->
            connection.connect("127.0.0.1", fake.connectPort)
            assertTrue(connection.banner.startsWith("device::"))
            assertEquals("ran: echo hello\n", connection.shell("echo hello"))
            assertEquals("ran: id\n", connection.shell("id"))       // a second stream on the same connection
        }
        assertEquals(listOf("echo hello", "id"), fake.commands.toList())
    }

    @Test fun anUnpairedKeyCannotConnect() {
        try {
            AdbConnection(key).use { connection ->
                connection.connect("127.0.0.1", fake.connectPort)
                connection.shell("echo hello")
            }
            fail("an unpaired key got in")
        } catch (e: IOException) {
            // the handshake or the first read fails
        }
        assertTrue(fake.commands.isEmpty())
    }
}
