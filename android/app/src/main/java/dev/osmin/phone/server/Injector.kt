package dev.osmin.phone.server

enum class TouchAction { DOWN, MOVE, UP }

/** What the computer can make the phone do. The real one (AndroidInjector) uses the system's input; tests use a fake. */
interface Injector {
    fun touch(action: TouchAction, x: Float, y: Float)

    fun key(code: Int)

    fun text(text: String)

    /** Sets the panel (see [Command.Panel]). @return null when it worked, otherwise the reason */
    fun panel(mode: Int): String?

    /** Keeps the phone awake without lighting anything (true) or stops doing so (false). */
    fun keepAwake(on: Boolean)

    /** Wakes the phone only if it is asleep. */
    fun wakeIfAsleep()

    /** Runs a command in the shell, without waiting for it. */
    fun shell(command: String)

    /** Stops every thread of the injector. */
    fun close()
}
