package dev.osmin.phone.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CommandsTest {
    @Test fun touches() {
        assertEquals(Command.Down(540f, 2040f), CommandParser.parse("d 540 2040"))
        assertEquals(Command.Move(10.5f, 20f), CommandParser.parse("m 10.5 20"))
        assertEquals(Command.Up(1f, 2f), CommandParser.parse("u 1 2"))
    }

    @Test fun keysAndText() {
        assertEquals(Command.Key(66), CommandParser.parse("k 66"))
        assertEquals(Command.Text("hello world 1234"), CommandParser.parse("t hello world 1234"))
        assertEquals(Command.Text(" "), CommandParser.parse("t  "))
    }

    @Test fun panelAndAwake() {
        assertEquals(Command.Panel(0), CommandParser.parse("p 0"))
        assertEquals(Command.Panel(3), CommandParser.parse("p 3"))
        assertEquals(Command.Awake(true), CommandParser.parse("w 1"))
        assertEquals(Command.Awake(false), CommandParser.parse("w 0"))
        assertEquals(Command.WakeIfAsleep, CommandParser.parse("z"))
        assertEquals(Command.Quit, CommandParser.parse("q"))
    }

    @Test fun shell() {
        assertEquals(Command.Shell("cmd statusbar expand-notifications"), CommandParser.parse("x cmd statusbar expand-notifications"))
        assertNull(CommandParser.parse("x "))
        assertNull(CommandParser.parse("x"))
    }

    @Test fun video() {
        assertEquals(Command.Video(544, 1200, 5000000), CommandParser.parse("v 544x1200 5000000"))
        assertNull(CommandParser.parse("v 544 5000000"))
    }

    @Test fun badLinesAreIgnored() {
        assertNull(CommandParser.parse(""))
        assertNull(CommandParser.parse("y 1 2"))
        assertNull(CommandParser.parse("d 1"))
        assertNull(CommandParser.parse("d a b"))
        assertNull(CommandParser.parse("k abc"))
    }

    @Test fun screenSize() {
        assertEquals(ScreenSize(1264, 2736), ScreenSize.parse("Physical size: 1264x2736\n"))
        assertEquals(ScreenSize(720, 1600), ScreenSize.parse("Physical size: 1080x2400\nOverride size: 720x1600\n"))
        assertNull(ScreenSize.parse("error"))
    }
}
