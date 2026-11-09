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
import java.lang.reflect.Method;

/**
 * Osmin's tiny input helper for the phone. It runs once with the rights of adb's shell
 * (app_process) and turns lines from the computer into real touches and keys, so there is no
 * new process per tap. Lines (coordinates are pixels of the screen):
 *   d x y   finger down      m x y   finger moves      u x y   finger up
 *   k code  a key (press and release)                  t text  type ASCII text
 * It says READY when it can inject, or ERR and the reason.
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

    private static void send(InputEvent event) throws Exception {
        inject.invoke(inputManager, event, 0); // 0: asynchronous
    }
}
