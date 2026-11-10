package dev.osmin.phone.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException
import java.net.ServerSocket

class LinkTest {
    private val token = "0123456789abcdef0123456789abcdef"

    @Test fun theSecretIsNeverSent() {
        ServerSocket(0).use { server ->
            var seen = ""
            val thread = Thread {
                val s = server.accept()
                // a computer that records everything the phone says
                val hello = readLineOf(s)
                seen += hello
                val nonce = "aa".repeat(16)
                s.getOutputStream().write("CHAL $nonce ${Link.proof(token, "srv", hello.split(' ')[3], nonce)}\n".toByteArray())
                seen += readLineOf(s)
                s.getOutputStream().write("OK\n".toByteArray())
            }.also { it.start() }
            Link.open(Endpoint("127.0.0.1", server.localPort, token), 'C', "1080x2400 36 X").close()
            thread.join(3000)
            assertFalse(seen.contains(token))
            assertTrue(seen.startsWith("HELLO2 C ${Link.fingerprint(token)} "))
            assertTrue(seen.contains("1080x2400 36 X"))
        }
    }

    @Test fun aMachineThatDoesNotKnowTheSecretIsNotTheComputer() {
        ServerSocket(0).use { server ->
            Thread {
                val s = server.accept()
                val hello = readLineOf(s).split(' ')
                val nonce = "bb".repeat(16)
                s.getOutputStream().write("CHAL $nonce ${Link.proof("a guess", "srv", hello[3], nonce)}\n".toByteArray())
                // the phone must not go on: it sends nothing more, and so the line below stays empty
                s.soTimeout = 1500
                try { readLineOf(s) } catch (e: Exception) { /* closed or silent */ }
            }.also { it.start() }
            try {
                Link.open(Endpoint("127.0.0.1", server.localPort, token), 'C', "info")
                fail("connected to a machine that does not know the secret")
            } catch (e: IOException) {
                assertTrue(e.message!!.contains("not the computer"))
            }
        }
    }

    @Test fun theComputerAnswersNoToAnotherSecret() {
        ServerSocket(0).use { server ->
            Thread { computerGreets(server.accept(), "another secret entirely") }.also { it.start() }
            try {
                Link.open(Endpoint("127.0.0.1", server.localPort, token), 'V', "info")
                fail()
            } catch (e: IOException) {
                assertTrue(e.message!!.contains("refused"))
            }
        }
    }

    @Test fun aWrongProofIsRefusedByTheComputer() {
        ServerSocket(0).use { server ->
            var greeting: Greeting? = Greeting('X', "x")
            Thread {
                val s = server.accept()
                greeting = computerGreets(s, token)
            }.also { it.start() }
            val socket = java.net.Socket("127.0.0.1", server.localPort)
            socket.getOutputStream().write("HELLO2 C ${Link.fingerprint(token)} ${"cc".repeat(16)}\n".toByteArray())
            val challenge = readLineOf(socket)
            assertTrue(challenge.startsWith("CHAL "))
            socket.getOutputStream().write("AUTH ${"00".repeat(32)} 1080x2400 36 X\n".toByteArray())
            assertEquals("NO", readLineOf(socket))
            Thread.sleep(100)
            assertNull(greeting)
        }
    }
}
