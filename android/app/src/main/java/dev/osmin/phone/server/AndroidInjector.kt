package dev.osmin.phone.server

import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.view.InputDevice
import android.view.InputEvent
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.MotionEvent
import java.io.File
import java.lang.reflect.Method

/**
 * The real [Injector]. It runs in a process with the rights of adb's shell (started with app_process), which is
 * what lets it inject touches and keys and switch the panel off while the phone stays awake. The system calls
 * are the ones the platform itself uses, found by reflection (no public API does this). Ported from the helper
 * that was tested on a real phone (phone-helper/src/dev/osmin/Input.java).
 */
class AndroidInjector : Injector {
    private val inputManager: Any
    private val inject: Method
    private var downTime = 0L

    private var displayToken: IBinder? = null          // found once: the display library can be loaded only once
    private var powerManager: Any? = null
    @Volatile private var keepDark = false
    @Volatile private var keepAwake = false

    init {
        val serviceManager = Class.forName("android.os.ServiceManager")
        val binder = serviceManager.getMethod("getService", String::class.java).invoke(null, "input") as IBinder
        val stub = Class.forName("android.hardware.input.IInputManager\$Stub")
        inputManager = stub.getMethod("asInterface", IBinder::class.java).invoke(null, binder)!!
        inject = inputManager.javaClass.getMethod("injectInputEvent", InputEvent::class.java, Int::class.javaPrimitiveType)
    }

    // --- touches and keys ----------------------------------------------------------------------------

    override fun touch(action: TouchAction, x: Float, y: Float) {
        val motion = when (action) {
            TouchAction.DOWN -> MotionEvent.ACTION_DOWN
            TouchAction.MOVE -> MotionEvent.ACTION_MOVE
            TouchAction.UP -> MotionEvent.ACTION_UP
        }
        val now = SystemClock.uptimeMillis()
        if (action == TouchAction.DOWN)
            downTime = now
        val properties = arrayOf(MotionEvent.PointerProperties().also {
            it.id = 0
            it.toolType = MotionEvent.TOOL_TYPE_FINGER
        })
        val coordinates = arrayOf(MotionEvent.PointerCoords().also {
            it.x = x
            it.y = y
            it.pressure = if (action == TouchAction.UP) 0f else 1f
            it.size = 1f
        })
        val event = MotionEvent.obtain(downTime, now, motion, 1, properties, coordinates, 0, 0, 1f, 1f, 0, 0,
            InputDevice.SOURCE_TOUCHSCREEN, 0)
        send(event)
        event.recycle()
    }

    override fun key(code: Int) {
        val now = SystemClock.uptimeMillis()
        send(KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD))
        send(KeyEvent(now, now, KeyEvent.ACTION_UP, code, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD))
    }

    override fun text(text: String) {
        val map = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD)
        val events = map.getEvents(text.toCharArray()) ?: return
        for (event in events)
            send(event)
    }

    private fun send(event: InputEvent) {
        inject.invoke(inputManager, event, 0)   // 0: asynchronous
    }

    // --- the panel ---------------------------------------------------------------------------------------

    override fun panel(mode: Int): String? {
        return when (mode) {
            0 -> {
                val error = setPanel(0)
                if (error == null)
                    startKeepingDark()
                error
            }
            3 -> {
                keepDark = false      // the system decides from here on (it is asleep, or will be)
                null
            }
            else -> {
                keepDark = false
                setPanel(mode)
            }
        }
    }

    /** Sets the panel's power mode. @return null when it worked, otherwise the reason */
    @Synchronized
    private fun setPanel(mode: Int): String? {
        return try {
            val surfaceControl = Class.forName("android.view.SurfaceControl")
            if (displayToken == null)
                displayToken = findDisplayToken(surfaceControl)
            val token = displayToken ?: return "no display token"
            surfaceControl.getMethod("setDisplayPowerMode", IBinder::class.java, Int::class.javaPrimitiveType).invoke(null, token, mode)
            null
        } catch (t: Throwable) {
            t.toString()
        }
    }

    /** Something may light the panel (a notification, a call, a wake): switch it off again a moment later. */
    private fun startKeepingDark() {
        if (keepDark)
            return
        keepDark = true
        Thread({
            while (keepDark) {
                try {
                    Thread.sleep(400)
                } catch (e: InterruptedException) {
                    return@Thread
                }
                if (keepDark)
                    setPanel(0)
            }
        }, "osmin-dark").also { it.isDaemon = true; it.start() }
    }

    private fun findDisplayToken(surfaceControl: Class<*>): IBinder? {
        // Android 14 and newer: the token comes from DisplayControl, which is in the system server's jar.
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                val factory = Class.forName("com.android.internal.os.ClassLoaderFactory")
                val create = factory.getDeclaredMethod("createClassLoader", String::class.java, String::class.java, String::class.java,
                    ClassLoader::class.java, Int::class.javaPrimitiveType, Boolean::class.javaPrimitiveType, String::class.java)
                // services.jar and the vendor's additions to it (services-magic.jar and the like): the library
                // looks for classes of both when it is loaded.
                val jars = StringBuilder("/system/framework/services.jar")
                File("/system/framework").list()?.sorted()?.forEach { name ->
                    if (name.startsWith("services") && name.endsWith(".jar") && name != "services.jar")
                        jars.append(':').append("/system/framework/").append(name)
                }
                val loader = create.invoke(null, jars.toString(), null, null, ClassLoader.getSystemClassLoader(), 0, true, null) as ClassLoader
                val control = loader.loadClass("com.android.server.display.DisplayControl")
                val load = Runtime::class.java.getDeclaredMethod("loadLibrary0", Class::class.java, String::class.java)
                load.isAccessible = true
                load.invoke(Runtime.getRuntime(), control, "android_servers")
                val ids = control.getMethod("getPhysicalDisplayIds").invoke(null) as LongArray
                return control.getMethod("getPhysicalDisplayToken", Long::class.javaPrimitiveType).invoke(null, ids[0]) as IBinder?
            } catch (ignored: Throwable) {
                // fall through to the older ways
            }
        }
        return try {
            val ids = surfaceControl.getMethod("getPhysicalDisplayIds").invoke(null) as LongArray
            surfaceControl.getMethod("getPhysicalDisplayToken", Long::class.javaPrimitiveType).invoke(null, ids[0]) as IBinder?
        } catch (ignored: Throwable) {
            surfaceControl.getMethod("getBuiltInDisplay", Int::class.javaPrimitiveType).invoke(null, 0) as IBinder?
        }
    }

    // --- sleep and wake --------------------------------------------------------------------------------------

    private fun power(): Any {
        powerManager?.let { return it }
        val serviceManager = Class.forName("android.os.ServiceManager")
        val binder = serviceManager.getMethod("getService", String::class.java).invoke(null, "power") as IBinder
        val manager = Class.forName("android.os.IPowerManager\$Stub").getMethod("asInterface", IBinder::class.java).invoke(null, binder)!!
        powerManager = manager
        return manager
    }

    private fun interactive(): Boolean {
        return try {
            val manager = power()
            manager.javaClass.getMethod("isInteractive").invoke(manager) as Boolean
        } catch (t: Throwable) {
            false     // unknown: treat as asleep, so a wake that was asked for is not lost
        }
    }

    /** Wakes the phone only when it is asleep; while it wakes the panel is switched off again and again. */
    override fun wakeIfAsleep() {
        if (interactive())
            return
        key(KeyEvent.KEYCODE_WAKEUP)
        if (keepDark) {
            repeat(25) {
                try {
                    Thread.sleep(40)
                } catch (e: InterruptedException) {
                    return
                }
                setPanel(0)
            }
        }
    }

    /** Tells the system the user is active, so the phone does not go to sleep, without lighting anything. */
    private fun userActivity() {
        try {
            val manager = power()
            val now = SystemClock.uptimeMillis()
            for (method in manager.javaClass.methods) {
                if (method.name != "userActivity")
                    continue
                when (method.parameterTypes.size) {
                    4 -> method.invoke(manager, 0, now, 0, 0)      // displayId, time, event (other), flags
                    3 -> method.invoke(manager, now, 0, 0)
                    else -> continue
                }
                return
            }
        } catch (ignored: Throwable) {
            // the phone will go to sleep by its own timeout, which is also fine
        }
    }

    override fun keepAwake(on: Boolean) {
        if (!on) {
            keepAwake = false
            return
        }
        if (keepAwake)
            return
        keepAwake = true
        Thread({
            while (keepAwake) {
                userActivity()
                try {
                    Thread.sleep(8000)
                } catch (e: InterruptedException) {
                    return@Thread
                }
            }
        }, "osmin-awake").also { it.isDaemon = true; it.start() }
    }

    override fun shell(command: String) {
        try {
            val process = ProcessBuilder("sh", "-c", command).redirectErrorStream(true).start()
            // The output is not wanted, but it must be read or the command may block on a full pipe.
            Thread({ try { process.inputStream.copyTo(java.io.OutputStream.nullOutputStream()) } catch (ignored: Exception) {} }, "osmin-shell").also { it.isDaemon = true; it.start() }
        } catch (ignored: Exception) {
        }
    }

    override fun close() {
        keepDark = false
        keepAwake = false
    }
}
