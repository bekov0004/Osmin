package dev.osmin.phone.adb

import org.conscrypt.Conscrypt
import java.net.Socket
import java.security.KeyStore
import java.security.Principal
import java.security.PrivateKey
import java.security.Provider
import java.security.cert.X509Certificate
import javax.net.ssl.KeyManager
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509ExtendedKeyManager
import javax.net.ssl.X509TrustManager

/** adb's TLS: version 1.3 only, a certificate made from the adb key on both sides, and no checking of the other's chain
 *  (trust comes from the pairing, not from certificate authorities). */
object AdbTls {
    private val provider: Provider by lazy { Conscrypt.newProvider() }

    /** The label adb exports keying material with, including its terminating NUL (it passes sizeof). */
    private const val EXPORT_LABEL = "adb-label\u0000"
    const val EXPORT_LENGTH = 64

    /** A key manager that always offers the one certificate (the server's list of acceptable issuers is ignored). */
    private class SingleKey(private val cert: X509Certificate, private val key: PrivateKey) : X509ExtendedKeyManager() {
        override fun getClientAliases(keyType: String?, issuers: Array<out Principal>?) = arrayOf("adb")
        override fun chooseClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, socket: Socket?) = "adb"
        override fun getServerAliases(keyType: String?, issuers: Array<out Principal>?) = arrayOf("adb")
        override fun chooseServerAlias(keyType: String?, issuers: Array<out Principal>?, socket: Socket?) = "adb"
        override fun getCertificateChain(alias: String?) = arrayOf(cert)
        override fun getPrivateKey(alias: String?) = key
    }

    /** Accepts every chain, and tells [onPeer] about the certificate of the other side. */
    class AcceptAll(private val onPeer: (X509Certificate) -> Boolean = { true }) : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String?) {
            if (chain.isEmpty() || !onPeer(chain[0]))
                throw java.security.cert.CertificateException("the key is not trusted")
        }
        override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String?) {
            if (chain.isEmpty() || !onPeer(chain[0]))
                throw java.security.cert.CertificateException("the key is not trusted")
        }
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    fun context(key: AdbKey, trust: X509TrustManager = AcceptAll()): SSLContext {
        val context = SSLContext.getInstance("TLSv1.3", provider)
        context.init(arrayOf<KeyManager>(SingleKey(key.certificate, key.keyPair.private)), arrayOf<TrustManager>(trust), null)
        return context
    }

    /** TLS 1.3 over a connected socket. `server`: this side is the TLS server (a fake adbd, in tests). */
    fun wrap(socket: Socket, key: AdbKey, server: Boolean, trust: X509TrustManager = AcceptAll()): SSLSocket {
        val ssl = context(key, trust).socketFactory.createSocket(socket, socket.inetAddress.hostAddress, socket.port, true) as SSLSocket
        ssl.useClientMode = !server
        ssl.enabledProtocols = arrayOf("TLSv1.3")
        if (server)
            ssl.needClientAuth = true
        return ssl
    }

    /** The 64 bytes both ends derive from the TLS session; the pairing code is extended with them. */
    fun exportKeyingMaterial(socket: SSLSocket): ByteArray =
        Conscrypt.exportKeyingMaterial(socket, EXPORT_LABEL, null, EXPORT_LENGTH)
}
