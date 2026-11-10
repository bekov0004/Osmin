package dev.osmin.phone.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket

/** The whole session against a stand-in for the computer, over real TCP. */
class SessionTest {
    private fun line(input: InputStream): String {
        val b = ByteArrayOutputStream()
        while (true) { val c = input.read(); if (c < 0 || c == '\n'.code) break; b.write(c) }
        return b.toString()
    }

    private class Computer(val server: ServerSocket) {
        lateinit var control: Socket
        lateinit var video: Socket
        val hellos = mutableListOf<String>()
    }

    /** Accepts the two connections of a phone (in whatever order they come), greeting each as the computer does. */
    private fun accept(server: ServerSocket, token: String): Computer {
        val c = Computer(server)
        repeat(2) {
            val s = server.accept()
            val greeting = computerGreets(s, token)!!
            c.hellos += "HELLO ${greeting.role} ${greeting.info}"
            if (greeting.role == 'C') c.control = s else c.video = s
        }
        return c
    }

    @Test fun controlVideoAndTheEnd() {
        ServerSocket(0).use { server ->
            val injector = FakeInjector()
            val source = EndlessSource()
            val session = Session(Endpoint("127.0.0.1", server.localPort, "secret123"), injector, source, ScreenSize(1080, 2400), "36 DNY_NX9", bitRate = 5000000)
            val thread = Thread { session.run() }.also { it.start() }
            val computer = accept(server, "secret123")

            assertTrue(computer.hellos.any { it.startsWith("HELLO C 1080x2400 36 DNY_NX9") })
            assertTrue(computer.hellos.any { it.startsWith("HELLO V 1080x2400 36 DNY_NX9") })

            // the picture arrives on its own connection
            val buffer = ByteArray(8)
            var got = 0
            computer.video.soTimeout = 3000
            while (got < buffer.size) got += computer.video.getInputStream().read(buffer, got, buffer.size - got)
            assertEquals(8, got)
            // 1080x2400 asked at about 540 wide, with both sides a multiple of 16
            assertEquals("544x1216@5000000", source.starts.first())

            // commands in, replies out
            val out = computer.control.getOutputStream()
            out.write("d 540 1200\nm 540 900\nu 540 900\nk 66\nt 1234\nw 1\nz\nx wm dismiss-keyguard\nbogus line\np 0\n".toByteArray()); out.flush()
            computer.control.soTimeout = 3000
            assertEquals("POWER OK 0", line(computer.control.getInputStream()))
            injector.await("touch down 540.0 1200.0", "touch move 540.0 900.0", "touch up 540.0 900.0", "key 66", "text 1234", "awake true", "wake", "shell wm dismiss-keyguard", "panel 0")

            // the computer leaves while the screen is dark: the phone is put to sleep (key 223) and the panel left to the system
            computer.control.close()
            injector.closed.waitFor()
            thread.join(3000)
            assertTrue(injector.calls.contains("key 223"))
            assertTrue(injector.calls.contains("panel 3"))
            assertTrue(injector.calls.indexOf("key 223") > injector.calls.indexOf("panel 0"))
        }
    }

    @Test fun aRefusedPanelIsReported() {
        ServerSocket(0).use { server ->
            val injector = FakeInjector().also { it.panelError = "no display token" }
            val session = Session(Endpoint("127.0.0.1", server.localPort, "t"), injector, FakeSource(), ScreenSize(1080, 2400), "36 X")
            val thread = Thread { session.run() }.also { it.start() }
            val computer = accept(server, "t")
            computer.control.getOutputStream().write("p 0\n".toByteArray())
            computer.control.soTimeout = 3000
            assertEquals("POWER ERR no display token", line(computer.control.getInputStream()))
            computer.control.getOutputStream().write("q\n".toByteArray())
            thread.join(3000)
            // the screen was not darkened, so closing does not put the phone to sleep
            assertTrue(!injector.calls.contains("key 223"))
        }
    }

    @Test fun aComputerThatRefusesStopsTheSession() {
        ServerSocket(0).use { server ->
            val injector = FakeInjector()
            val session = Session(Endpoint("127.0.0.1", server.localPort, "wrong"), injector, FakeSource(), ScreenSize(1080, 2400), "36 X")
            val thread = Thread { session.run() }.also { it.start() }
            val s = server.accept()
            assertEquals(null, computerGreets(s, "another secret"))
            thread.join(3000)
            assertTrue(!thread.isAlive)
            assertTrue(injector.calls.contains("close"))
        }
    }

    @Test fun pictureSizeIsAMultipleOf16() {
        for ((w, h) in listOf(1080 to 2400, 1264 to 2736, 720 to 1600, 480 to 800)) {
            ServerSocket(0).use { server ->
                val source = EndlessSource()
                val session = Session(Endpoint("127.0.0.1", server.localPort, "t"), FakeInjector(), source, ScreenSize(w, h), "36 X")
                val thread = Thread { session.run() }.also { it.start() }
                val computer = accept(server, "t")
                val end = System.currentTimeMillis() + 3000
                while (source.starts.isEmpty() && System.currentTimeMillis() < end) Thread.sleep(10)
                val (pw, ph) = source.starts.first().substringBefore('@').split('x').map { it.toInt() }
                assertEquals(0, pw % 16); assertEquals(0, ph % 16)
                assertTrue(pw <= 544)
                computer.control.getOutputStream().write("q\n".toByteArray())
                thread.join(3000)
            }
        }
    }

    @Test fun aSilentComputerEndsTheSessionAndThePhoneSaysItIsThere() {
        ServerSocket(0).use { server ->
            val injector = FakeInjector()
            val session = Session(Endpoint("127.0.0.1", server.localPort, "t"), injector, FakeSource(), ScreenSize(1080, 2400), "36 X", silenceMs = 700, beatMs = 100)
            var outcome: Session.Outcome? = null
            val thread = Thread { outcome = session.run() }.also { it.start() }
            val computer = accept(server, "t")
            computer.control.soTimeout = 3000
            // the phone's heartbeat arrives although nobody asked for anything
            assertEquals("H", line(computer.control.getInputStream()))
            // the computer says nothing (a network changed under it): the session ends by itself
            thread.join(4000)
            assertTrue(!thread.isAlive)
            assertEquals(Session.Outcome.ENDED, outcome)
        }
    }

    @Test fun theComputerCanEndTheServerForGood() {
        ServerSocket(0).use { server ->
            val session = Session(Endpoint("127.0.0.1", server.localPort, "t"), FakeInjector(), FakeSource(), ScreenSize(1080, 2400), "36 X")
            var outcome: Session.Outcome? = null
            val thread = Thread { outcome = session.run() }.also { it.start() }
            val computer = accept(server, "t")
            computer.control.getOutputStream().write("h\ne\n".toByteArray())
            thread.join(3000)
            assertEquals(Session.Outcome.EXIT, outcome)
        }
    }
}
