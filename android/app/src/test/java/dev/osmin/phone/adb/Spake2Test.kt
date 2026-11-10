package dev.osmin.phone.adb

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigInteger

class Spake2Test {
    private fun onCurve(p: Ed25519.Point): Boolean {
        val x2 = p.x * p.x % Ed25519.P
        val y2 = p.y * p.y % Ed25519.P
        return (y2 - x2 - BigInteger.ONE - Ed25519.D * x2 * y2).mod(Ed25519.P).signum() == 0
    }

    @Test fun theConstantsAreBoringSslsPoints() {
        // x and y as printed in BoringSSL's source next to its tables
        assertEquals(BigInteger("49918732221787544735331783592030787422991506689877079631459872391322455579424"), Spake2.N.x)
        assertEquals(BigInteger("54629554431565467720832445949441049581317094546788069926228343916274969994000"), Spake2.N.y)
        assertEquals(BigInteger("31406539342727633121250288103050113562375374900226415211311216773867585644232"), Spake2.M.x)
        assertEquals(BigInteger("21177308356423958466833845032658859666296341766942662650232962324899758529114"), Spake2.M.y)
        assertTrue(onCurve(Spake2.M) && onCurve(Spake2.N))
    }

    @Test fun theCurveMathIsRight() {
        // The base point has the standard encoding and the order l.
        assertEquals("5866666666666666666666666666666666666666666666666666666666666666", Ed25519.encode(Ed25519.BASE).joinToString("") { "%02x".format(it) })
        assertTrue(onCurve(Ed25519.BASE))
        assertEquals(Ed25519.IDENTITY, Ed25519.multiply(Ed25519.BASE, Ed25519.L))
        val a = Ed25519.multiply(Ed25519.BASE, BigInteger.valueOf(1234567))
        val b = Ed25519.multiply(Ed25519.BASE, BigInteger.valueOf(7654321))
        assertEquals(Ed25519.multiply(Ed25519.BASE, BigInteger.valueOf(1234567 + 7654321)), Ed25519.add(a, b))
        assertEquals(a, Ed25519.subtract(Ed25519.add(a, b), b))
        assertEquals(a, Ed25519.decode(Ed25519.encode(a)))
        assertNull(Ed25519.decode(ByteArray(32) { 0xFF.toByte() }))
    }

    @Test fun twoSidesWithTheSamePasswordAgree() {
        repeat(3) {
            val client = Spake2.client()
            val server = Spake2.server()
            val password = "123456".toByteArray() + ByteArray(64) { it.toByte() }
            val mc = client.generateMessage(password)
            val ms = server.generateMessage(password)
            assertEquals(32, mc.size)
            val kc = client.processMessage(ms)
            val ks = server.processMessage(mc)
            assertNotNull(kc)
            assertEquals(64, kc!!.size)
            assertArrayEquals(kc, ks)
        }
    }

    @Test fun differentPasswordsDoNotAgree() {
        val client = Spake2.client()
        val server = Spake2.server()
        val mc = client.generateMessage("123456".toByteArray())
        val ms = server.generateMessage("654321".toByteArray())
        val kc = client.processMessage(ms)
        val ks = server.processMessage(mc)
        assertTrue(kc != null && ks != null && !kc.contentEquals(ks))
    }

    @Test fun aBadMessageIsRefused() {
        val client = Spake2.client()
        client.generateMessage("123456".toByteArray())
        assertNull(client.processMessage(ByteArray(31)))
        assertNull(client.processMessage(ByteArray(32) { 0xFF.toByte() }))
    }
}
