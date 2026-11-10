package dev.osmin.phone.start

import dev.osmin.phone.adb.AdbKey
import dev.osmin.phone.adb.FakeAdbd
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class StarterTest {
    private lateinit var fake: FakeAdbd
    private val key = AdbKey.generate("phone@osmin")
    private val target = ConnectTarget("192.168.0.250", 43211, "0123456789abcdef0123456789abcdef")

    private class FakeDiscovery(var pairing: Address?, var connect: Address?) : Discovery {
        override fun find(serviceType: String, timeoutMs: Long) = if (serviceType == Starter.PAIRING) pairing else connect
    }

    @Before fun setUp() { fake = FakeAdbd(); fake.start() }
    @After fun tearDown() = fake.stop()

    private fun discovery() = FakeDiscovery(Address("127.0.0.1", fake.pairingPort), Address("127.0.0.1", fake.connectPort))

    @Test fun pairThenStartRunsTheCommand() {
        val starter = Starter(key, discovery(), "/data/app/~~abc==/dev.osmin.phone-xyz==/base.apk")
        assertEquals("adb-FAKE0001", starter.pair("123456").text)
        starter.start(target)
        assertEquals(1, fake.commands.size)
        assertEquals(StartCommand.build("/data/app/~~abc==/dev.osmin.phone-xyz==/base.apk", target), fake.commands[0])
    }

    @Test fun startWithoutPairingFails() {
        val starter = Starter(key, discovery(), "/x/base.apk")
        try { starter.start(target); fail("started without being paired") } catch (e: StartException) { assertTrue(e.message!!.contains("pair")) }
        assertTrue(fake.commands.isEmpty())
    }

    @Test fun aWrongCodeIsExplained() {
        try { Starter(key, discovery(), "/x/base.apk").pair("999999"); fail("paired with a wrong code") } catch (e: StartException) { assertTrue(e.message!!.contains("code")) }
        assertTrue(fake.paired.isEmpty())
    }

    @Test fun noPairingWindowIsExplained() {
        val d = discovery().also { it.pairing = null }
        try { Starter(key, d, "/x/base.apk").pair("123456"); fail() } catch (e: StartException) { assertTrue(e.message!!.contains("Pair device")) }
    }

    @Test fun noWirelessDebuggingIsExplained() {
        val d = discovery().also { it.connect = null }
        try { Starter(key, d, "/x/base.apk").start(target); fail() } catch (e: StartException) { assertTrue(e.message!!.contains("Wireless debugging")) }
    }

    @Test fun theCodeMustBeDigits() {
        try { Starter(key, discovery(), "/x/base.apk").pair("12ab56"); fail() } catch (e: StartException) { assertTrue(e.message!!.contains("number")) }
    }

    @Test fun theLinkRoundTrips() {
        assertEquals(target, ConnectTarget.parse(target.toLink()))
        assertEquals(target, ConnectTarget.parse("  ${target.toLink()}\n"))
        assertEquals("osmin://connect?host=192.168.0.250&port=43211&token=0123456789abcdef0123456789abcdef", target.toLink())
    }

    @Test fun badLinksAreRefused() {
        for (bad in listOf("", "http://example.com", "osmin://connect", "osmin://connect?host=a&port=0&token=0123456789abcdef",
            "osmin://connect?host=a b&port=1&token=0123456789abcdef", "osmin://connect?host=h&port=99999&token=0123456789abcdef",
            "osmin://connect?host=h&port=1&token=short", "osmin://connect?host=h;rm&port=1&token=0123456789abcdef",
            "osmin://connect?host=h&port=1&token=0123456789abcdef'; reboot; '")) {
            assertNull("accepted: $bad", ConnectTarget.parse(bad))
        }
    }

    @Test fun theCommandCannotBeInjected() {
        val command = StartCommand.build("/data/app/x/base.apk", target)
        assertTrue(command.startsWith("CLASSPATH='/data/app/x/base.apk' setsid nohup app_process / dev.osmin.phone.server.Server '192.168.0.250' 43211 '0123456789abcdef0123456789abcdef'"))
        assertTrue(command.endsWith("&"))
        try { StartCommand.build("/x/ba'se.apk", target); fail() } catch (e: IllegalArgumentException) { /* refused */ }
        assertNotNull(command)
    }
}
