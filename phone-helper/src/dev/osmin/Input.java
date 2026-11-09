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
 *   p mode  the screen panel: 0 dark (the phone stays awake and unlocked), 2 normal
 * It says READY when it can inject, or ERR and the reason; for "p" it says POWER OK or POWER ERR reason.
 */
public final class Input {
    private static Object inputManager;
    private static Method inject;
    private static long downTime;

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
        try {
            Class<?> surfaceControl = Class.forName("android.view.SurfaceControl");
            IBinder token = displayToken(surfaceControl);
            if (token == null) {
                System.out.println("POWER ERR no display token");
            } else {
                surfaceControl.getMethod("setDisplayPowerMode", IBinder.class, int.class).invoke(null, token, mode);
                System.out.println("POWER OK " + mode);
            }
        } catch (Throwable t) {
            System.out.println("POWER ERR " + t);
        }
        System.out.flush();
    }

    private static IBinder displayToken(Class<?> surfaceControl) throws Exception {
        // Android 14 and newer: the token comes from DisplayControl, which is in the system server's jar.
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                Class<?> factory = Class.forName("com.android.internal.os.ClassLoaderFactory");
                Method create = factory.getDeclaredMethod("createClassLoader", String.class, String.class, String.class,
                    ClassLoader.class, int.class, boolean.class, String.class);
                ClassLoader loader = (ClassLoader) create.invoke(null, "/system/framework/services.jar", null, null,
                    ClassLoader.getSystemClassLoader(), 0, true, null);
                Class<?> control = loader.loadClass("com.android.server.display.DisplayControl");
                Method load = Runtime.class.getDeclaredMethod("loadLibrary0", Class.class, String.class);
                load.setAccessible(true);
                load.invoke(Runtime.getRuntime(), ClassLoader.class, "android_servers");
                long[] ids = (long[]) control.getMethod("getPhysicalDisplayIds").invoke(null);
                return (IBinder) control.getMethod("getPhysicalDisplayToken", long.class).invoke(null, ids[0]);
            } catch (Throwable ignored) {
                // fall through to the older ways
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
