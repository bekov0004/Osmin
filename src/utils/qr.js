/**
 * A small QR code encoder (byte mode, error correction level M, versions 1 to 10: up to 213 bytes).
 * encodeQr('text') -> {size, get(x, y)} where get() is true for a dark module. No quiet zone.
 *
 * Pure JavaScript, no dependencies, so it runs inside GNOME Shell.
 */

// Per version 1..10 at level M: total codewords, error-correction codewords per block, blocks.
const TOTAL = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const dataCodewords = v => TOTAL[v - 1] - EC_PER_BLOCK[v - 1] * BLOCKS[v - 1];

// --- Reed-Solomon over GF(256), polynomial 0x11D -------------------------------------------------

const EXP = new Array(512);
const LOG = new Array(256);
(() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 0x100)
            x ^= 0x11D;
    }
    for (let i = 255; i < 512; i++)
        EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function generator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
        const next = new Array(poly.length + 1).fill(0);
        for (let j = 0; j < poly.length; j++) {
            next[j] ^= poly[j];
            next[j + 1] ^= mul(poly[j], EXP[i]);
        }
        poly = next;
    }
    return poly; // highest power first, leading 1
}

function remainder(data, degree) {
    const gen = generator(degree);
    const result = new Array(degree).fill(0);
    for (const byte of data) {
        const factor = byte ^ result.shift();
        result.push(0);
        for (let i = 0; i < degree; i++)
            result[i] ^= mul(gen[i + 1], factor);
    }
    return result;
}

// --- Bits -------------------------------------------------------------------------------------------

function bitsFor(bytes, version) {
    const bits = [];
    const push = (value, count) => {
        for (let i = count - 1; i >= 0; i--)
            bits.push((value >>> i) & 1);
    };
    push(0b0100, 4);
    push(bytes.length, version < 10 ? 8 : 16);
    for (const b of bytes)
        push(b, 8);
    const capacity = dataCodewords(version) * 8;
    push(0, Math.min(4, capacity - bits.length));
    while (bits.length % 8)
        bits.push(0);
    for (let pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11)
        push(pad, 8);
    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
        let value = 0;
        for (let j = 0; j < 8; j++)
            value = (value << 1) | bits[i + j];
        codewords.push(value);
    }
    return codewords;
}

function interleave(data, version) {
    const blocks = BLOCKS[version - 1];
    const ec = EC_PER_BLOCK[version - 1];
    const total = TOTAL[version - 1];
    const shortCount = blocks - (total % blocks);
    const shortLen = Math.floor(total / blocks);
    const dataBlocks = [];
    const ecBlocks = [];
    let at = 0;
    for (let i = 0; i < blocks; i++) {
        const len = shortLen - ec + (i < shortCount ? 0 : 1);
        const part = data.slice(at, at + len);
        at += len;
        dataBlocks.push(part);
        ecBlocks.push(remainder(part, ec));
    }
    const out = [];
    const longest = Math.max(...dataBlocks.map(b => b.length));
    for (let i = 0; i < longest; i++)
        dataBlocks.forEach(b => i < b.length && out.push(b[i]));
    for (let i = 0; i < ec; i++)
        ecBlocks.forEach(b => out.push(b[i]));
    return out;
}

// --- The matrix ---------------------------------------------------------------------------------------

function bch(value, poly, bitsTotal, bitsData) {
    let rem = value << (bitsTotal - bitsData);
    for (let i = bitsTotal - 1; i >= bitsTotal - bitsData; i--) {
        if ((rem >>> i) & 1)
            rem ^= poly << (i - (bitsTotal - bitsData));
    }
    return (value << (bitsTotal - bitsData)) | rem;
}

const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function build(codewords, version, mask) {
    const size = version * 4 + 17;
    const dark = Array.from({length: size}, () => new Array(size).fill(false));
    const fixed = Array.from({length: size}, () => new Array(size).fill(false));
    const set = (x, y, value) => {
        dark[y][x] = value;
        fixed[y][x] = true;
    };

    // Timing
    for (let i = 0; i < size; i++) {
        set(6, i, i % 2 === 0);
        set(i, 6, i % 2 === 0);
    }
    // Finders with their separators
    const finder = (cx, cy) => {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const x = cx + dx, y = cy + dy;
                if (x < 0 || y < 0 || x >= size || y >= size)
                    continue;
                const d = Math.max(Math.abs(dx), Math.abs(dy));
                set(x, y, d !== 2 && d !== 4);
            }
        }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);
    // Alignment
    const pos = ALIGN[version - 1];
    for (const cy of pos) {
        for (const cx of pos) {
            if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6))
                continue;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++)
                    set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }
        }
    }
    // Reserve the format and version areas (written below)
    for (let i = 0; i < 9; i++) {
        fixed[8][i] = true;
        fixed[i][8] = true;
    }
    for (let i = 0; i < 8; i++) {
        fixed[8][size - 1 - i] = true;
        fixed[size - 1 - i][8] = true;
    }
    if (version >= 7) {
        for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 3; j++) {
                fixed[size - 11 + j][i] = true;
                fixed[i][size - 11 + j] = true;
            }
        }
    }
    set(8, size - 8, true); // the always-dark module

    // Data, zigzag from the bottom right
    const bits = [];
    for (const cw of codewords) {
        for (let i = 7; i >= 0; i--)
            bits.push((cw >>> i) & 1);
    }
    let bit = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6)
            right = 5;
        for (let v = 0; v < size; v++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - v : v;
                if (fixed[y][x])
                    continue;
                let value = bit < bits.length ? bits[bit] === 1 : false;
                bit++;
                if (MASKS[mask](x, y))
                    value = !value;
                dark[y][x] = value;
            }
        }
    }

    // Format information: level M is 00
    const format = bch((0b00 << 3) | mask, 0x537, 15, 5) ^ 0x5412;
    const f = i => ((format >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++)
        dark[i][8] = f(i);
    dark[7][8] = f(6);
    dark[8][8] = f(7);
    dark[8][7] = f(8);
    for (let i = 9; i < 15; i++)
        dark[8][14 - i] = f(i);
    for (let i = 0; i < 8; i++)
        dark[8][size - 1 - i] = f(i);
    for (let i = 8; i < 15; i++)
        dark[size - 15 + i][8] = f(i);
    dark[size - 8][8] = true;

    // Version information
    if (version >= 7) {
        const info = bch(version, 0x1F25, 18, 6);
        for (let i = 0; i < 18; i++) {
            const bitValue = ((info >>> i) & 1) === 1;
            const a = size - 11 + (i % 3);
            const b = Math.floor(i / 3);
            dark[b][a] = bitValue;
            dark[a][b] = bitValue;
        }
    }
    return dark;
}

/** A rough penalty (runs and blocks) to pick a mask that looks even. Any mask decodes. */
function penalty(dark) {
    const size = dark.length;
    let score = 0;
    for (let y = 0; y < size; y++) {
        let run = 1;
        for (let x = 1; x < size; x++) {
            run = dark[y][x] === dark[y][x - 1] ? run + 1 : 1;
            if (run === 5)
                score += 3;
            else if (run > 5)
                score++;
        }
    }
    for (let x = 0; x < size; x++) {
        let run = 1;
        for (let y = 1; y < size; y++) {
            run = dark[y][x] === dark[y - 1][x] ? run + 1 : 1;
            if (run === 5)
                score += 3;
            else if (run > 5)
                score++;
        }
    }
    for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
            if (dark[y][x] === dark[y][x + 1] && dark[y][x] === dark[y + 1][x] && dark[y][x] === dark[y + 1][x + 1])
                score += 3;
        }
    }
    let count = 0;
    for (const row of dark)
        count += row.filter(Boolean).length;
    score += Math.floor(Math.abs(count * 20 - size * size * 10) / (size * size)) * 10;
    return score;
}

/** @param {string} text @returns {{size: number, get: (x: number, y: number) => boolean}} */
export function encodeQr(text) {
    const bytes = [...new TextEncoder().encode(text)];
    let version = 1;
    while (version <= 10 && bytes.length * 8 + 4 + (version < 10 ? 8 : 16) > dataCodewords(version) * 8)
        version++;
    if (version > 10)
        throw new Error('The text is too long for the QR code');
    const codewords = interleave(bitsFor(bytes, version), version);
    let best = null;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
        const matrix = build(codewords, version, mask);
        const score = penalty(matrix);
        if (score < bestScore) {
            best = matrix;
            bestScore = score;
        }
    }
    return {size: best.length, get: (x, y) => best[y][x]};
}
