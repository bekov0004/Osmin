package dev.osmin.phone.server

/**
 * Keeps the phone connected to the computer wherever the two are: when a session ends (the network changed, the card on
 * the computer was closed, the computer went to sleep) it looks for the computer again and connects again, with nobody
 * touching anything. It looks harder the less it finds: a second at first, half a minute at most.
 *
 * @param find the addresses where the port is open now, most likely first (the last one that worked is tried at once)
 * @param sessionFor what runs a session with this computer: it blocks until the session is over and tells how it went
 */
class Roamer(
    private val port: Int,
    private val token: String,
    private val firstHost: String?,
    private val find: () -> List<String>,
    private val sessionFor: (Endpoint) -> (() -> Session.Outcome),
    private val sleep: (Long) -> Unit = { Thread.sleep(it) },
    private val keepGoing: () -> Boolean = { true },
    private val log: (String) -> Unit = {},
) {
    @Volatile var last: String? = firstHost
        private set

    fun run() {
        var wait = MIN_WAIT_MS
        while (keepGoing()) {
            var connected = false
            val hosts = (listOfNotNull(last) + find()).distinct()
            for (host in hosts) {
                if (!keepGoing())
                    return
                when (sessionFor(Endpoint(host, port, token))()) {
                    Session.Outcome.NOT_CONNECTED -> continue
                    Session.Outcome.EXIT -> return
                    Session.Outcome.ENDED -> {
                        connected = true
                        last = host
                        log("the session with $host ended")
                    }
                }
                break
            }
            wait = if (connected) MIN_WAIT_MS else minOf(wait * 3 / 2, MAX_WAIT_MS)
            sleep(wait)
        }
    }

    companion object {
        const val MIN_WAIT_MS = 1_500L
        const val MAX_WAIT_MS = 30_000L
    }
}
