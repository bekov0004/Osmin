package dev.osmin.phone.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** The computer dials the phone (which listens): the same greeting with the roles swapped. */
class InboxTest {
    private val token = "0123456789abcdef0123456789abcdef"

    /** What the computer does: HELLO2, check the phone's proof, AUTH. @return the phone's answer (OK <info>, or NO) */
    private fun dial(port: Int, role: Char, secret: String = token, checkProof: Boolean = true): Pair<Socket, String> {
        val socket = Socket("127.0.0.1", port)
        val mine = "ab".repeat(16)
        socket.getOutputStream().write("HELLO2 $role ${Link.fingerprint(secret)} $mine\n".toByteArray())
        val challenge = readLineOf(socket).split(' ')
        if (challenge[0] != "CHAL") return socket to challenge.joinToString(" ")
        if (checkProof) assertEquals(Link.proof(secret, "srv", mine, challenge[1]), challenge[2])
        socket.getOutputStream().write("AUTH ${Link.proof(secret, "cli", challenge[1], mine)} -\n".toByteArray())
        return socket to readLineOf(socket)
    }

    private fun inbox(serve: (Socket, Socket) -> Unit): Inbox {
        val inbox = Inbox(0, token, greeting = { "1080x2400 36 X" }, serve = serve)
        assertTrue(inbox.open())
        Thread { inbox.run() }.also { it.isDaemon = true; it.start() }
        return inbox
    }

    @Test fun theComputerDialsTwiceAndIsServed() {
        val served = CountDownLatch(1)
        val got = AtomicReference<Pair<Socket, Socket>>()
        val inbox = inbox { c, v -> got.set(c to v); served.countDown() }
        val (control, answer) = dial(inbox.boundPort, 'C')
        assertEquals("OK 1080x2400 36 X", answer)                       // the computer learns the screen from this
        val (video, _) = dial(inbox.boundPort, 'V')
        assertTrue(served.await(3, TimeUnit.SECONDS))
        // the first connection is the control one, whichever came first
        control.getOutputStream().write("ping\n".toByteArray())
        assertEquals("ping", readLineOf(got.get().first))
        video.getOutputStream().write("raw\n".toByteArray())
        assertEquals("raw", readLineOf(got.get().second))
        inbox.close()
    }

    @Test fun theOrderOfTheTwoConnectionsDoesNotMatter() {
        val served = CountDownLatch(1)
        val got = AtomicReference<Pair<Socket, Socket>>()
        val inbox = inbox { c, v -> got.set(c to v); served.countDown() }
        val (video, _) = dial(inbox.boundPort, 'V')
        val (control, _) = dial(inbox.boundPort, 'C')
        assertTrue(served.await(3, TimeUnit.SECONDS))
        control.getOutputStream().write("c\n".toByteArray())
        assertEquals("c", readLineOf(got.get().first))
        inbox.close()
    }

    @Test fun anotherSecretIsRefusedAndNeverServed() {
        val served = CountDownLatch(1)
        val inbox = inbox { _, _ -> served.countDown() }
        assertEquals("NO", dial(inbox.boundPort, 'C', secret = "another secret entirely").second)
        assertEquals("NO", dial(inbox.boundPort, 'V', secret = "another secret entirely").second)
        assertTrue(!served.await(500, TimeUnit.MILLISECONDS))
        inbox.close()
    }

    @Test fun aBadProofIsRefused() {
        val inbox = inbox { _, _ -> }
        val socket = Socket("127.0.0.1", inbox.boundPort)
        socket.getOutputStream().write("HELLO2 C ${Link.fingerprint(token)} ${"cd".repeat(16)}\n".toByteArray())
        assertTrue(readLineOf(socket).startsWith("CHAL "))
        socket.getOutputStream().write("AUTH ${"00".repeat(32)} -\n".toByteArray())
        assertEquals("NO", readLineOf(socket))
        inbox.close()
    }

    @Test fun aSessionOverARealInboxRunsTheCommands() {
        val injector = FakeInjector()
        val session = Session(null, injector, FakeSource(), ScreenSize(1080, 2400), "36 X")
        val ended = CountDownLatch(1)
        val inbox = inbox { c, v -> session.serve(c, v); ended.countDown() }
        val (control, _) = dial(inbox.boundPort, 'C')
        dial(inbox.boundPort, 'V')
        control.getOutputStream().write("z\nk 66\nq\n".toByteArray())
        assertTrue(ended.await(3, TimeUnit.SECONDS))
        assertTrue(injector.calls.containsAll(listOf("wake", "key 66")))
        assertNotNull(session.greeting)
        inbox.close()
    }
}
