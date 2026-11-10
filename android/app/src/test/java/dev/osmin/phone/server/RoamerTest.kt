package dev.osmin.phone.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList

class RoamerTest {
    /** A roamer whose sessions end the way the test scripts. */
    private fun roamer(
        results: MutableList<Session.Outcome>,
        hostsEachRound: List<List<String>>,
        asked: MutableList<String>,
        waits: MutableList<Long>,
        first: String? = null,
    ): Roamer {
        var round = 0
        return Roamer(1234, "token", first,
            find = { hostsEachRound.getOrElse(round++) { emptyList() } },
            sessionFor = { endpoint -> asked += endpoint.host; val outcome = results.removeAt(0); { outcome } },
            sleep = { waits += it },
            keepGoing = { results.isNotEmpty() },
        )
    }

    @Test fun triesTheLastHostFirstAndStopsOnExit() {
        val asked = CopyOnWriteArrayList<String>()
        val waits = mutableListOf<Long>()
        val results = mutableListOf(Session.Outcome.ENDED, Session.Outcome.ENDED, Session.Outcome.EXIT)
        roamer(results, listOf(listOf("10.0.0.5"), listOf("10.0.0.5")), asked, waits, first = "10.0.0.5").run()
        assertEquals(listOf("10.0.0.5", "10.0.0.5", "10.0.0.5"), asked.toList())
        assertEquals(listOf(Roamer.MIN_WAIT_MS, Roamer.MIN_WAIT_MS), waits)       // connected, so it comes back soon
    }

    @Test fun anotherNetworkAnotherAddress() {
        val asked = CopyOnWriteArrayList<String>()
        val waits = mutableListOf<Long>()
        // the old address is gone in the new network; the search finds the computer at another one
        val results = mutableListOf(Session.Outcome.NOT_CONNECTED, Session.Outcome.ENDED, Session.Outcome.NOT_CONNECTED, Session.Outcome.EXIT)
        val roamer = roamer(results, listOf(listOf("192.168.43.141"), listOf("192.168.43.141")), asked, waits, first = "192.168.0.250")
        roamer.run()
        assertEquals(listOf("192.168.0.250", "192.168.43.141"), asked.take(2))
        assertEquals("192.168.43.141", roamer.last)
    }

    @Test fun looksLessOftenTheLessItFinds() {
        val asked = CopyOnWriteArrayList<String>()
        val waits = mutableListOf<Long>()
        val results = MutableList(12) { Session.Outcome.NOT_CONNECTED } + Session.Outcome.EXIT
        roamer(results.toMutableList(), emptyList(), asked, waits, first = "10.0.0.5").run()
        assertTrue(waits.zipWithNext().all { (a, b) -> b >= a })
        assertEquals(Roamer.MAX_WAIT_MS, waits.last())
        assertTrue(waits.first() < Roamer.MAX_WAIT_MS)
    }

    @Test fun aRealSessionThatCannotConnectReturnsAtOnce() {
        val port = ServerSocket(0).use { it.localPort }        // nothing listens there any more
        val outcome = Session(Endpoint("127.0.0.1", port, "t"), FakeInjector(), FakeSource(), ScreenSize(1080, 2400), "x", connectTimeoutMs = 500).run()
        assertEquals(Session.Outcome.NOT_CONNECTED, outcome)
    }
}
