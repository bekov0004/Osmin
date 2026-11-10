package dev.osmin.phone.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.ServerSocket

class LanTest {
    @Test fun onlyPrivateAddresses() {
        assertTrue(Lan.isPrivate("192.168.0.15"))
        assertTrue(Lan.isPrivate("10.42.0.1"))
        assertTrue(Lan.isPrivate("172.20.10.2"))        // the iPhone-style hotspot range, also used by Android sharing
        assertFalse(Lan.isPrivate("172.32.0.1"))
        assertFalse(Lan.isPrivate("100.72.3.4"))         // the carrier's shared address space
        assertFalse(Lan.isPrivate("8.8.8.8"))
        assertFalse(Lan.isPrivate("fe80::1"))
    }

    @Test fun arpKeepsOnlyCompleteEntries() {
        val text = """
            IP address       HW type     Flags       HW address            Mask     Device
            192.168.43.141   0x1         0x2         aa:bb:cc:dd:ee:ff     *        wlan0
            192.168.43.77    0x1         0x0         00:00:00:00:00:00     *        wlan0
            192.168.43.9     0x1         0x2         00:00:00:00:00:00     *        wlan0
        """.trimIndent()
        assertEquals(listOf("192.168.43.141"), Lan.parseArp(text))
    }

    @Test fun theLikelyAddressesComeFirst() {
        val nets = listOf(LocalNet("wlan0", "192.168.0.15", 24))
        val list = Lan.candidates(nets, listOf("192.168.0.250", "10.0.0.5"), "192.168.0.99")
        assertEquals("192.168.0.99", list[0])           // the one that worked
        assertEquals("192.168.0.250", list[1])          // a machine the phone already knows (the other network's is dropped)
        assertEquals("192.168.0.1", list[2])            // what a shared connection gives the computer
        assertFalse(list.contains("192.168.0.15"))      // the phone itself
        assertFalse(list.contains("10.0.0.5"))
        assertFalse(list.contains("192.168.0.0"))
        assertFalse(list.contains("192.168.0.255"))
        assertEquals(list.size, list.toSet().size)
        assertTrue(list.containsAll(listOf("192.168.0.2", "192.168.0.254")))
    }

    @Test fun aHotspotOfThePhoneIsSearchedToo() {
        // the phone shares its connection: its own address is the first of the network, the computer is one of the clients
        val nets = listOf(LocalNet("wlan0", "192.168.0.15", 24), LocalNet("ap0", "192.168.43.1", 24))
        val list = Lan.candidates(nets, listOf("192.168.43.141"), null)
        assertTrue(list.contains("192.168.43.141"))
        assertTrue(list.indexOf("192.168.43.141") < list.indexOf("192.168.43.50"))
        assertFalse(list.contains("192.168.43.1"))
    }

    @Test fun aBigNetworkIsNotSearchedWholeButAroundThePhone() {
        val list = Lan.candidates(listOf(LocalNet("wlan0", "10.20.30.40", 8)), emptyList(), null)
        assertTrue(list.size <= 254)
        assertTrue(list.contains("10.20.30.41"))
        assertFalse(list.contains("10.21.0.1"))
    }

    @Test fun findsTheOpenPortAmongMany() {
        ServerSocket(0).use { server ->
            val hosts = listOf("127.0.0.2", "127.0.0.1", "127.0.0.3")
            // nothing listens on the others; the answer keeps the order given
            assertEquals(listOf("127.0.0.1"), Lan.open(hosts, server.localPort, timeoutMs = 300).filter { it == "127.0.0.1" })
        }
    }
}
