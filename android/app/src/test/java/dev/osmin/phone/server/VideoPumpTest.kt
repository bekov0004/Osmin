package dev.osmin.phone.server

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch

class VideoPumpTest {
    private fun waitUntil(ms: Long = 3000, check: () -> Boolean) {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) { if (check()) return; Thread.sleep(10) }
        throw AssertionError("timed out")
    }

    @Test fun relaysTheBytes() {
        val out = ByteArrayOutputStream()
        val source = FakeSource(byteArrayOf(1, 2, 3, 4, 5))
        val pump = VideoPump(source, out, 540, 1184, 5000000, retryDelayMs = 5, restartDelayMs = 5, maxTries = 2)
        pump.start()
        waitUntil { out.size() >= 5 }
        pump.stop()
        assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5), out.toByteArray().copyOf(5))
        assertEquals("540x1184@5000000", source.starts.first())
    }

    @Test fun retriesWhenTheEncoderRefuses() {
        // two starts that give nothing, then one that works: the picture comes in the end
        val out = ByteArrayOutputStream()
        val source = FakeSource(null, null, byteArrayOf(9, 9, 9))
        val pump = VideoPump(source, out, 540, 1184, 5000000, retryDelayMs = 5, restartDelayMs = 5, maxTries = 6)
        pump.start()
        waitUntil { out.size() >= 3 }
        pump.stop()
        assertTrue(source.starts.size >= 3)
        assertArrayEquals(byteArrayOf(9, 9, 9), out.toByteArray().copyOf(3))
    }

    @Test fun givesUpAfterTooManyEmptyStarts() {
        val gave = CountDownLatch(1)
        val source = FakeSource()          // every start gives nothing
        val pump = VideoPump(source, ByteArrayOutputStream(), 540, 1184, 5000000, retryDelayMs = 2, restartDelayMs = 2, maxTries = 3, onGiveUp = { gave.countDown() })
        pump.start()
        gave.waitFor()
        assertEquals(0, gave.count)
        assertEquals(4, source.starts.size)     // the first try and three more
    }

    @Test fun restartsAfterAnEndedRun() {
        // screenrecord ends by itself after three minutes: the next start continues the picture
        val out = ByteArrayOutputStream()
        val source = FakeSource(byteArrayOf(1, 2), byteArrayOf(3, 4))
        val pump = VideoPump(source, out, 540, 1184, 5000000, retryDelayMs = 5, restartDelayMs = 5, maxTries = 2)
        pump.start()
        waitUntil { out.size() >= 4 }
        pump.stop()
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), out.toByteArray().copyOf(4))
    }

    @Test fun aNewSizeRestartsThePicture() {
        val source = EndlessSource()
        val pump = VideoPump(source, ByteArrayOutputStream(), 540, 1184, 5000000, retryDelayMs = 5, restartDelayMs = 5)
        pump.start()
        waitUntil { source.starts.size == 1 }
        pump.change(720, 1600, 8000000)
        waitUntil { source.starts.size >= 2 }
        pump.stop()
        assertEquals("720x1600@8000000", source.starts[1])
    }
}
