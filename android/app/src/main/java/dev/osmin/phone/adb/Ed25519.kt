package dev.osmin.phone.adb

import java.math.BigInteger

/**
 * The points of the curve edwards25519 (-x^2 + y^2 = 1 + d x^2 y^2 over the integers mod 2^255-19), with the few
 * operations SPAKE2 needs. Plain big integers: slow beside C, fast enough for one pairing. Points are affine (x, y).
 */
object Ed25519 {
    val P: BigInteger = BigInteger.ONE.shiftLeft(255) - BigInteger.valueOf(19)

    /** The order of the prime-order subgroup. */
    val L: BigInteger = BigInteger.ONE.shiftLeft(252) + BigInteger("27742317777372353535851937790883648493")

    val D: BigInteger = (BigInteger.valueOf(-121665) * BigInteger.valueOf(121666).modInverse(P)).mod(P)
    private val SQRT_M1: BigInteger = BigInteger.TWO.modPow((P - BigInteger.ONE).shiftRight(2), P)

    data class Point(val x: BigInteger, val y: BigInteger)

    val IDENTITY = Point(BigInteger.ZERO, BigInteger.ONE)

    /** The standard base point (y = 4/5). */
    val BASE: Point = decode(
        ByteArray(32).also {
            val y = (BigInteger.valueOf(4) * BigInteger.valueOf(5).modInverse(P)).mod(P)
            val bytes = littleEndian(y)
            bytes.copyInto(it)
        },
    )!!

    fun add(a: Point, b: Point): Point {
        val dxy = D * a.x * b.x * a.y * b.y % P
        val x3 = (a.x * b.y + b.x * a.y) % P * (BigInteger.ONE + dxy).modInverse(P) % P
        val y3 = (a.y * b.y + a.x * b.x) % P * (BigInteger.ONE - dxy).mod(P).modInverse(P) % P
        return Point(x3, y3)
    }

    fun negate(a: Point) = Point((P - a.x) % P, a.y)

    fun subtract(a: Point, b: Point) = add(a, negate(b))

    /** k * a for a non-negative k (any size; no reduction: the cofactor bits matter to SPAKE2). */
    fun multiply(a: Point, k: BigInteger): Point {
        var result = IDENTITY
        var addend = a
        var scalar = k
        while (scalar.signum() > 0) {
            if (scalar.testBit(0))
                result = add(result, addend)
            addend = add(addend, addend)
            scalar = scalar.shiftRight(1)
        }
        return result
    }

    /** The 32-byte encoding: y in little-endian with the low bit of x in the top bit. */
    fun encode(a: Point): ByteArray {
        val bytes = littleEndian(a.y)
        if (a.x.testBit(0))
            bytes[31] = (bytes[31].toInt() or 0x80).toByte()
        return bytes
    }

    /** @return null when the bytes are not the encoding of a point of the curve */
    fun decode(bytes: ByteArray): Point? {
        if (bytes.size != 32)
            return null
        val sign = (bytes[31].toInt() and 0x80) != 0
        val copy = bytes.copyOf()
        copy[31] = (copy[31].toInt() and 0x7F).toByte()
        val y = fromLittleEndian(copy)
        if (y >= P)
            return null
        val y2 = y * y % P
        val u = (y2 - BigInteger.ONE).mod(P)
        val v = (D * y2 + BigInteger.ONE) % P
        // x = (u/v)^((p+3)/8), fixed with sqrt(-1) when needed
        val ratio = u * v.modInverse(P) % P
        var x = ratio.modPow((P + BigInteger.valueOf(3)).shiftRight(3), P)
        if ((x * x - ratio).mod(P).signum() != 0)
            x = x * SQRT_M1 % P
        if ((x * x - ratio).mod(P).signum() != 0)
            return null
        if (x.signum() == 0 && sign)
            return null
        if (x.testBit(0) != sign)
            x = (P - x) % P
        return Point(x, y)
    }

    fun littleEndian(value: BigInteger, size: Int = 32): ByteArray {
        val big = value.toByteArray()          // big-endian, may have a leading zero
        val out = ByteArray(size)
        for (i in 0 until minOf(size, big.size))
            out[i] = big[big.size - 1 - i]
        return out
    }

    fun fromLittleEndian(bytes: ByteArray): BigInteger {
        val reversed = bytes.reversedArray()
        return BigInteger(1, reversed)
    }
}
