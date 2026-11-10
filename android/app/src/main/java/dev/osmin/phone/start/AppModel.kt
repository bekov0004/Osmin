package dev.osmin.phone.start

import android.content.Context
import android.os.Handler
import android.os.Looper
import dev.osmin.phone.adb.AdbKey
import java.io.File
import java.util.concurrent.Executors

/**
 * What the app knows and does, in one place the screen and the notification both use: the key (paired once), the
 * link of the computer, and the work of pairing and starting, one thing at a time on a background thread.
 */
object AppModel {
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableListOf<() -> Unit>()
    private lateinit var appContext: Context

    @Volatile var status: String = ""
        private set
    @Volatile var busy: Boolean = false
        private set

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    private val prefs get() = appContext.getSharedPreferences("osmin-phone", Context.MODE_PRIVATE)
    private val key: AdbKey by lazy { AdbKey.loadOrCreate(File(appContext.filesDir, "adbkey"), "osmin@phone") }

    var paired: Boolean
        get() = prefs.getBoolean("paired", false)
        private set(value) = prefs.edit().putBoolean("paired", value).apply()

    var target: ConnectTarget?
        get() = prefs.getString("target", null)?.let(ConnectTarget::parse)
        set(value) = prefs.edit().putString("target", value?.toLink()).apply()

    fun addListener(listener: () -> Unit) { synchronized(listeners) { listeners += listener } }
    fun removeListener(listener: () -> Unit) { synchronized(listeners) { listeners -= listener } }

    private fun say(text: String) {
        status = text
        val copy = synchronized(listeners) { listeners.toList() }
        main.post { copy.forEach { it() } }
    }

    private fun starter() = Starter(key, NsdDiscovery(appContext), appContext.applicationInfo.sourceDir)

    /** Pairs with the code from the pairing window and then, if a computer link is known, starts the server. */
    fun pair(code: String, then: () -> Unit = {}) = work("Pairing…") {
        starter().pair(code)
        paired = true
        say("Paired.")
        then()
        target?.let { start(it) }
    }

    /** Starts the phone's server so that it connects to the computer of [link]. */
    fun start(link: ConnectTarget) = work("Connecting to the computer…") {
        starter().start(link)
        say("Started. Osmin on the computer should show this phone in a moment.")
    }

    /** Runs a piece of work on the background thread, one at a time, and reports a failure in plain words. */
    private fun work(first: String, body: () -> Unit) {
        executor.execute {
            busy = true
            say(first)
            try {
                body()
            } catch (e: StartException) {
                say(e.message ?: "It did not work.")
            } catch (e: Exception) {
                say("It did not work: ${e.message ?: e.javaClass.simpleName}")
            } finally {
                busy = false
                say(status)
            }
        }
    }

    /** Finishes the work in the background (used by the notification, which has only a few seconds of its own). */
    fun runLater(body: () -> Unit) = executor.execute(body)
}
