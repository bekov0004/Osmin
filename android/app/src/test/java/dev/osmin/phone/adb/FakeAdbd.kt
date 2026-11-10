package dev.osmin.phone.adb

import java.io.DataInputStream
import java.io.IOException
import java.math.BigInteger
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList

/**
 * A stand-in for adbd's wireless debugging, for tests: a pairing server (adb/pairing_connection, server side) and the
 * TLS connect port (CNXN, STLS, TLS 1.3 with a client certificate that must belong to a paired key, CNXN, shell).
 * Written from the same sources as the client, so it is also run against the real `adb` of this computer to check
 * that the two agree (see FakeAdbdMain).
 */
class FakeAdbd(val code: String = "123456", val guid: String = "adb-FAKE0001") {
    val serverKey: AdbKey = AdbKey.generate("server@fake")
    val paired = CopyOnWriteArrayList<BigInteger>()          // the moduli of the keys that were paired
    val commands = CopyOnWriteArrayList<String>()            // the shell commands that were run
    @Volatile var shellOutput: (String) -> String = { "" }

    private val pairingServer = ServerSocket(0, 5, InetAddress.getByName("127.0.0.1"))
    private val connectServer = ServerSocket(0, 5, InetAddress.getByName("127.0.0.1"))
    val pairingPort get() = pairingServer.localPort
    val connectPort get() = connectServer.localPort
    @Volatile private var stopped = false

    fun start() {
        thread("fake-pairing") { acceptLoop(pairingServer, ::pairing) }
        thread("fake-connect") { acceptLoop(connectServer, ::connect) }
    }

    fun stop() {
        stopped = true
        pairingServer.close()
        connectServer.close()
    }

    private fun thread(name: String, body: () -> Unit) = Thread(body, name).also { it.isDaemon = true; it.start() }

    private fun acceptLoop(server: ServerSocket, handler: (Socket) -> Unit) {
        while (!stopped) {
            val socket = try { server.accept() } catch (e: IOException) { return }
            thread("fake-connection") {
                try {
                    socket.soTimeout = 10_000
                    handler(socket)
                } catch (e: Exception) {
                    System.err.println("[fake adbd] ${e.javaClass.simpleName}: ${e.message}")
                } finally {
                    try { socket.close() } catch (ignored: IOException) {}
                }
            }
        }
    }

    private fun modulusOf(keyText: String): BigInteger {
        val raw = Base64.getDecoder().decode(keyText.substringBefore(' '))
        return Ed25519.fromLittleEndian(raw.copyOfRange(8, 8 + 256))
    }

    private fun pairing(plain: Socket) {
        val tls = AdbTls.wrap(plain, serverKey, server = true)
        tls.startHandshake()
        val spake = Spake2.server()
        val mine = spake.generateMessage(code.toByteArray() + AdbTls.exportKeyingMaterial(tls))
        val input = DataInputStream(tls.inputStream)
        PairingClient.writePacket(tls.outputStream, PairingClient.TYPE_SPAKE2, mine)
        val theirs = PairingClient.readPacket(input, PairingClient.TYPE_SPAKE2)
        val cipher = PairingCipher(spake.processMessage(theirs) ?: return)
        val info = cipher.decrypt(PairingClient.readPacket(input, PairingClient.TYPE_PEER_INFO)) ?: return   // a wrong code ends here
        val end = (1 until info.size).firstOrNull { info[it].toInt() == 0 } ?: info.size
        paired += modulusOf(String(info, 1, end - 1))
        val reply = ByteArray(PairingClient.MAX_PEER_INFO)
        reply[0] = PairingClient.TYPE_DEVICE_GUID.toByte()
        guid.toByteArray().copyInto(reply, 1)
        PairingClient.writePacket(tls.outputStream, PairingClient.TYPE_PEER_INFO, cipher.encrypt(reply))
    }

    private fun connect(plain: Socket) {
        val rawIn = DataInputStream(plain.getInputStream())
        val rawOut = plain.getOutputStream()
        val cnxn = AdbMessage.read(rawIn)
        check(cnxn.command == AdbCommand.CNXN) { "the first message was ${cnxn}" }
        AdbMessage.write(rawOut, AdbMessage(AdbCommand.STLS, AdbMessage.STLS_VERSION, 0))
        val stls = AdbMessage.read(rawIn)
        check(stls.command == AdbCommand.STLS) { "wanted STLS, got $stls" }

        // Only a certificate of a paired key is accepted.
        val trust = AdbTls.AcceptAll { cert -> paired.contains((cert.publicKey as java.security.interfaces.RSAPublicKey).modulus) }
        val tls = AdbTls.wrap(plain, serverKey, server = true, trust = trust)
        tls.startHandshake()
        val input = DataInputStream(tls.inputStream)
        val out = tls.outputStream
        AdbMessage.write(out, AdbMessage(AdbCommand.CNXN, AdbMessage.VERSION, AdbMessage.MAX_DATA,
            "device::ro.product.name=fake;ro.product.model=Fake Phone;ro.product.device=fake;features=cmd".toByteArray()))
        var remoteId = 100
        while (true) {
            val message = try { AdbMessage.read(input) } catch (e: IOException) { return }
            when (message.command) {
                AdbCommand.OPEN -> {
                    val local = remoteId++
                    val service = String(message.data).trimEnd('\u0000')
                    AdbMessage.write(out, AdbMessage(AdbCommand.OKAY, local, message.arg0))
                    if (service.startsWith("shell:")) {
                        val command = service.removePrefix("shell:")
                        commands += command
                        val output = shellOutput(command)
                        if (output.isNotEmpty())
                            AdbMessage.write(out, AdbMessage(AdbCommand.WRTE, local, message.arg0, output.toByteArray()))
                    }
                    AdbMessage.write(out, AdbMessage(AdbCommand.CLSE, local, message.arg0))
                }
                AdbCommand.OKAY, AdbCommand.CLSE -> {}
                else -> return
            }
        }
    }
}

/**
 * Runs the fake adbd on its own (java -cp ... dev.osmin.phone.adb.FakeAdbdMain) so that the real adb can be pointed at it:
 * prints the two ports and the pairing code, runs until its input ends.
 */
object FakeAdbdMain {
    @JvmStatic
    fun main(args: Array<String>) {
        val fake = FakeAdbd(code = args.getOrNull(0) ?: "123456")
        fake.shellOutput = { command -> "ran: $command\n" }
        fake.start()
        println("PAIRING_PORT=${fake.pairingPort} CONNECT_PORT=${fake.connectPort} CODE=${fake.code}")
        System.out.flush()
        // Lines on the input: "paired?" answers how many keys were paired, "commands" lists the shell commands.
        val reader = System.`in`.bufferedReader()
        while (true) {
            when (reader.readLine() ?: break) {
                "paired?" -> println("PAIRED=${fake.paired.size}")
                "commands" -> println("COMMANDS=${fake.commands.joinToString(" | ")}")
            }
            System.out.flush()
        }
        fake.stop()
    }
}
