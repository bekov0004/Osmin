package dev.osmin;

import android.os.IBinder;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.InputEvent;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import android.view.MotionEvent;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import android.os.Build;

import java.lang.reflect.Method;

/**
 * Osmin's tiny input helper for the phone. It runs once with the rights of adb's shell
 * (app_process) and turns lines from the computer into real touches and keys, so there is no
 * new process per tap. Lines (coordinates are pixels of the screen):
 *   d x y   finger down      m x y   finger moves      u x y   finger up
 *   k code  a key (press and release)                  t text  type ASCII text
 *   p mode  the screen panel: 0 dark (the phone stays awake and unlocked; kept dark here, the panel is
 *           switched off again every 400 ms in case something lit it), 2 lit again,
 *           3 stop keeping it dark and leave the panel as the system has it
 *   w 1/0   keep the phone awake without lighting it (a user-activity signal every 8 s) / stop
 *   z       wake the phone only if it is asleep (and keep the panel dark while it wakes, if it is dark)
 * It says READY when it can inject, or ERR and the reason; for "p" it says POWER OK or POWER ERR reason.
 */
public final class Input {
    private static Object inputManager;
    private static Method inject;
    private static long downTime;
    private static IBinder displayToken;      // found once: the library of the display control can be loaded only once
    private static Object power;              // the system's power manager
    private static volatile boolean keepDark;
    private static volatile boolean keepAwake;

    public static void main(String[] args) throws Exception {
        try {
            Class<?> serviceManager = Class.forName("android.os.ServiceManager");
            IBinder binder = (IBinder) serviceManager.getMethod("getService", String.class).invoke(null, "input");
            Class<?> stub = Class.forName("android.hardware.input.IInputManager$Stub");
            inputManager = stub.getMethod("asInterface", IBinder.class).invoke(null, binder);
            inject = inputManager.getClass().getMethod("injectInputEvent", InputEvent.class, int.class);
        } catch (Throwable t) {
            System.out.println("ERR " + t);
            return;
        }
        System.out.println("READY");
        System.out.flush();
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        String line;
        while ((line = in.readLine()) != null) {
            try {
                run(line);
            } catch (Throwable t) {
                System.out.println("ERR " + t);
                System.out.flush();
            }
        }
        // Leave at once: shutting the virtual machine down normally crashes once the display library is loaded.
        System.out.flush();
        Runtime.getRuntime().halt(0);
    }

    private static void run(String line) throws Exception {
        if (line.isEmpty())
            return;
        char kind = line.charAt(0);
        String rest = line.length() > 2 ? line.substring(2) : "";
        switch (kind) {
            case 'd': touch(MotionEvent.ACTION_DOWN, rest); break;
            case 'm': touch(MotionEvent.ACTION_MOVE, rest); break;
            case 'u': touch(MotionEvent.ACTION_UP, rest); break;
            case 'k': key(Integer.parseInt(rest.trim())); break;
            case 't': type(rest); break;
            case 'p': power(Integer.parseInt(rest.trim())); break;
            case 'w': stayAwake(rest.trim().equals("1")); break;
            case 'z': wakeIfAsleep(); break;
            default: break;
        }
    }

    private static void touch(int action, String rest) throws Exception {
        String[] p = rest.trim().split(" ");
        float x = Float.parseFloat(p[0]);
        float y = Float.parseFloat(p[1]);
        long now = SystemClock.uptimeMillis();
        if (action == MotionEvent.ACTION_DOWN)
            downTime = now;
        MotionEvent.PointerProperties[] props = {new MotionEvent.PointerProperties()};
        props[0].id = 0;
        props[0].toolType = MotionEvent.TOOL_TYPE_FINGER;
        MotionEvent.PointerCoords[] coords = {new MotionEvent.PointerCoords()};
        coords[0].x = x;
        coords[0].y = y;
        coords[0].pressure = action == MotionEvent.ACTION_UP ? 0f : 1f;
        coords[0].size = 1f;
        MotionEvent event = MotionEvent.obtain(downTime, now, action, 1, props, coords, 0, 0, 1f, 1f, 0, 0,
            InputDevice.SOURCE_TOUCHSCREEN, 0);
        send(event);
        event.recycle();
    }

    private static void key(int code) throws Exception {
        long now = SystemClock.uptimeMillis();
        send(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD));
        send(new KeyEvent(now, now, KeyEvent.ACTION_UP, code, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD));
    }

    private static void type(String text) throws Exception {
        KeyCharacterMap map = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD);
        KeyEvent[] events = map.getEvents(text.toCharArray());
        if (events == null)
            return;
        for (KeyEvent e : events)
            send(e);
    }

    /**
     * Turns the panel of the screen off or on while the phone stays awake, so the picture and the touches
     * keep working but nothing is lit. The same way as the rest of the platform does it: through the
     * display token of SurfaceControl (found differently on different Android versions).
     */
    private static void power(int mode) {
        if (mode == 0) {
            String error = setPanel(0);
            if (error == null) {
                startKeepingDark();
                System.out.println("POWER OK 0");
            } else {
                System.out.println("POWER ERR " + error);
            }
        } else if (mode == 3) {
            keepDark = false;          // the system decides from here on (it is asleep, or will be)
            System.out.println("POWER OK 3");
        } else {
            keepDark = false;
            String error = setPanel(mode);
            System.out.println(error == null ? "POWER OK " + mode : "POWER ERR " + error);
        }
        System.out.flush();
    }

    /** Sets the panel's power mode. @return null when it worked, otherwise the reason */
    private static synchronized String setPanel(int mode) {
        try {
            Class<?> surfaceControl = Class.forName("android.view.SurfaceControl");
            if (displayToken == null)
                displayToken = displayToken(surfaceControl);
            if (displayToken == null)
                return "no display token";
            surfaceControl.getMethod("setDisplayPowerMode", IBinder.class, int.class).invoke(null, displayToken, mode);
            return null;
        } catch (Throwable t) {
            return String.valueOf(t);
        }
    }

    /** Something may light the panel (a notification, a call, a wake): switch it off again a moment later. */
    private static void startKeepingDark() {
        if (keepDark)
            return;
        keepDark = true;
        Thread thread = new Thread(() -> {
            while (keepDark) {
                try {
                    Thread.sleep(400);
                } catch (InterruptedException e) {
                    return;
                }
                if (keepDark)
                    setPanel(0);
            }
        }, "osmin-dark");
        thread.setDaemon(true);
        thread.start();
    }

    private static Object powerManager() throws Exception {
        if (power == null) {
            Class<?> serviceManager = Class.forName("android.os.ServiceManager");
            IBinder binder = (IBinder) serviceManager.getMethod("getService", String.class).invoke(null, "power");
            power = Class.forName("android.os.IPowerManager$Stub").getMethod("asInterface", IBinder.class).invoke(null, binder);
        }
        return power;
    }

    private static boolean interactive() {
        try {
            return (Boolean) powerManager().getClass().getMethod("isInteractive").invoke(powerManager());
        } catch (Throwable t) {
            return false;   // unknown: treat as asleep, so a wake that was asked for is not lost
        }
    }

    /** Wakes the phone only when it is asleep; while it wakes the panel is switched off again and again. */
    private static void wakeIfAsleep() throws Exception {
        if (interactive())
            return;
        key(224);
        if (keepDark) {
            for (int i = 0; i < 25; i++) {
                try {
                    Thread.sleep(40);
                } catch (InterruptedException e) {
                    return;
                }
                setPanel(0);
            }
        }
    }

    /** Tells the system the user is active, so the phone does not go to sleep, without lighting anything. */
    private static void userActivity() {
        try {
            Object manager = powerManager();
            long now = SystemClock.uptimeMillis();
            for (Method method : manager.getClass().getMethods()) {
                if (!method.getName().equals("userActivity"))
                    continue;
                int count = method.getParameterTypes().length;
                if (count == 4)
                    method.invoke(manager, 0, now, 0, 0);      // displayId, time, event (other), flags
                else if (count == 3)
                    method.invoke(manager, now, 0, 0);
                else
                    continue;
                return;
            }
        } catch (Throwable ignored) {
            // the phone will go to sleep by its own timeout, which is also fine
        }
    }

    private static void stayAwake(boolean on) {
        if (!on) {
            keepAwake = false;
            return;
        }
        if (keepAwake)
            return;
        keepAwake = true;
        Thread thread = new Thread(() -> {
            while (keepAwake) {
                userActivity();
                try {
                    Thread.sleep(8000);
                } catch (InterruptedException e) {
                    return;
                }
            }
        }, "osmin-awake");
        thread.setDaemon(true);
        thread.start();
    }

    private static IBinder displayToken(Class<?> surfaceControl) throws Exception {
        // Android 14 and newer: the token comes from DisplayControl, which is in the system server's jar.
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                Class<?> factory = Class.forName("com.android.internal.os.ClassLoaderFactory");
                Method create = factory.getDeclaredMethod("createClassLoader", String.class, String.class, String.class,
                    ClassLoader.class, int.class, boolean.class, String.class);
                // services.jar and the vendor's additions to it (services-magic.jar and the like): the library
                // looks for classes of both when it is loaded.
                StringBuilder jars = new StringBuilder("/system/framework/services.jar");
                String[] names = new java.io.File("/system/framework").list();
                if (names != null) {
                    java.util.Arrays.sort(names);
                    for (String name : names) {
                        if (name.startsWith("services") && name.endsWith(".jar") && !name.equals("services.jar"))
                            jars.append(':').append("/system/framework/").append(name);
                    }
                }
                ClassLoader loader = (ClassLoader) create.invoke(null, jars.toString(), null, null,
                    ClassLoader.getSystemClassLoader(), 0, true, null);
                Class<?> control = loader.loadClass("com.android.server.display.DisplayControl");
                Method load = Runtime.class.getDeclaredMethod("loadLibrary0", Class.class, String.class);
                load.setAccessible(true);
                load.invoke(Runtime.getRuntime(), control, "android_servers");
                long[] ids = (long[]) control.getMethod("getPhysicalDisplayIds").invoke(null);
                return (IBinder) control.getMethod("getPhysicalDisplayToken", long.class).invoke(null, ids[0]);
            } catch (Throwable t) {
                // fall through to the older ways, but say why this one did not work
                Throwable root = t;
                while (root.getCause() != null)
                    root = root.getCause();
                System.out.println("POWER DBG new way: " + root);
            }
        }
        try {
            long[] ids = (long[]) surfaceControl.getMethod("getPhysicalDisplayIds").invoke(null);
            return (IBinder) surfaceControl.getMethod("getPhysicalDisplayToken", long.class).invoke(null, ids[0]);
        } catch (Throwable ignored) {
            return (IBinder) surfaceControl.getMethod("getBuiltInDisplay", int.class).invoke(null, 0);
        }
    }

    private static void send(InputEvent event) throws Exception {
        inject.invoke(inputManager, event, 0); // 0: asynchronous
    }
}
