package dev.osmin.phone.start

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import java.net.NetworkInterface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Finds adbd's services on this phone with the system's service discovery (mDNS). Only a service whose address belongs
 * to this phone counts: another phone or a computer on the network may publish the same kinds of service.
 */
@Suppress("DEPRECATION")
class NsdDiscovery(context: Context) : Discovery {
    private val nsd = context.applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager

    private fun ownAddresses(): Set<String> = try {
        NetworkInterface.getNetworkInterfaces().toList().flatMap { it.inetAddresses.toList() }.mapNotNull { it.hostAddress?.substringBefore('%') }.toSet()
    } catch (e: Exception) {
        emptySet()
    }

    override fun find(serviceType: String, timeoutMs: Long): Address? {
        val found = AtomicReference<Address?>(null)
        val done = CountDownLatch(1)
        val resolving = AtomicBoolean(false)
        val own = ownAddresses()

        val resolver = object : NsdManager.ResolveListener {
            override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                resolving.set(false)
            }

            override fun onServiceResolved(info: NsdServiceInfo) {
                val host = info.host?.hostAddress?.substringBefore('%')
                if (host != null && (host in own || info.host.isLoopbackAddress)) {
                    found.set(Address(host, info.port))
                    done.countDown()
                }
                resolving.set(false)
            }
        }
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(type: String) {}
            override fun onDiscoveryStopped(type: String) {}
            override fun onStartDiscoveryFailed(type: String, errorCode: Int) { done.countDown() }
            override fun onStopDiscoveryFailed(type: String, errorCode: Int) {}
            override fun onServiceLost(info: NsdServiceInfo) {}
            override fun onServiceFound(info: NsdServiceInfo) {
                // One resolution at a time (the old API cannot do more); a service found while one runs is found again.
                if (found.get() == null && resolving.compareAndSet(false, true)) {
                    try {
                        nsd.resolveService(info, resolver)
                    } catch (e: IllegalArgumentException) {
                        resolving.set(false)
                    }
                }
            }
        }
        nsd.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
        try {
            done.await(timeoutMs, TimeUnit.MILLISECONDS)
        } finally {
            try {
                nsd.stopServiceDiscovery(listener)
            } catch (ignored: IllegalArgumentException) {
            }
        }
        return found.get()
    }
}
