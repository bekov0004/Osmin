// The brain of the command bar: a calculator and a unit converter. Plain functions (no shell
// imports); nothing is ever passed to eval.

/**
 * Evaluates an arithmetic expression: + - * / ^ % ( ), decimals, "x" and "×" as times, and the
 * constants pi and e, with the functions sqrt, abs, round, floor, ceil, sin, cos, tan, ln, log.
 * @returns {number|null} null when the text is not an expression
 */
export function calculate(text) {
    const source = text.trim().toLowerCase().replace(/×|x(?=\s*[\d(])/g, '*').replace(/÷/g, '/').replace(/,/g, '.').replace(/\s+/g, '');
    if (!source || !/[\d]/.test(source) || !/^[\d+\-*/^%().a-z]+$/.test(source))
        return null;
    const tokens = source.match(/\d+\.?\d*|\.\d+|[a-z]+|[+\-*/^%()]/g);
    if (!tokens || tokens.join('') !== source)
        return null;
    // A lone number is not worth an answer.
    if (tokens.length === 1 && /^[\d.]+$/.test(tokens[0]))
        return null;
    let index = 0;
    const functions = {
        sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
        sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log10,
    };
    const constants = {pi: Math.PI, e: Math.E};
    const fail = () => {
        throw new Error('bad expression');
    };
    const parseExpression = () => {
        let value = parseTerm();
        while (tokens[index] === '+' || tokens[index] === '-') {
            const op = tokens[index++];
            const right = parseTerm();
            value = op === '+' ? value + right : value - right;
        }
        return value;
    };
    const parseTerm = () => {
        let value = parsePower();
        while (tokens[index] === '*' || tokens[index] === '/' || tokens[index] === '%') {
            const op = tokens[index++];
            const right = parsePower();
            value = op === '*' ? value * right : op === '/' ? value / right : value % right;
        }
        return value;
    };
    const parsePower = () => {
        const base = parseUnary();
        if (tokens[index] === '^') {
            index++;
            return base ** parsePower();
        }
        return base;
    };
    const parseUnary = () => {
        if (tokens[index] === '-') {
            index++;
            return -parseUnary();
        }
        if (tokens[index] === '+') {
            index++;
            return parseUnary();
        }
        return parseAtom();
    };
    const parseAtom = () => {
        const token = tokens[index++];
        if (token === undefined)
            return fail();
        if (/^[\d.]/.test(token))
            return Number(token);
        if (token === '(') {
            const value = parseExpression();
            if (tokens[index++] !== ')')
                fail();
            return value;
        }
        if (token in constants)
            return constants[token];
        if (token in functions) {
            if (tokens[index++] !== '(')
                fail();
            const value = parseExpression();
            if (tokens[index++] !== ')')
                fail();
            return functions[token](value);
        }
        return fail();
    };
    try {
        const value = parseExpression();
        if (index !== tokens.length || !Number.isFinite(value))
            return null;
        return value;
    } catch (e) {
        return null;
    }
}

/** 1234.5678 -> "1234.5678", 0.1+0.2 -> "0.3" (no floating point noise) */
export function formatNumber(value) {
    const rounded = Number(value.toPrecision(12));
    return String(rounded);
}

const UNITS = {
    length: {m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, mile: 1609.344, miles: 1609.344, yd: 0.9144, ft: 0.3048, foot: 0.3048, feet: 0.3048, in: 0.0254, inch: 0.0254, inches: 0.0254},
    mass: {kg: 1, g: 0.001, mg: 0.000001, t: 1000, lb: 0.45359237, lbs: 0.45359237, oz: 0.028349523125},
    volume: {l: 1, ml: 0.001, gal: 3.785411784, cup: 0.2365882365, floz: 0.0295735295625},
    time: {s: 1, sec: 1, min: 60, h: 3600, hr: 3600, d: 86400, day: 86400, days: 86400, week: 604800, weeks: 604800},
    data: {b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4},
    speed: {'m/s': 1, 'km/h': 1 / 3.6, kmh: 1 / 3.6, mph: 0.44704, kn: 0.514444},
};

const TEMPERATURE = {c: 'c', '°c': 'c', celsius: 'c', f: 'f', '°f': 'f', fahrenheit: 'f', k: 'k', kelvin: 'k'};

const toCelsius = (value, unit) => (unit === 'c' ? value : unit === 'f' ? (value - 32) * 5 / 9 : value - 273.15);
const fromCelsius = (value, unit) => (unit === 'c' ? value : unit === 'f' ? value * 9 / 5 + 32 : value + 273.15);

/**
 * "5 km to mi", "100 f in c", "2.5 kg = lb".
 * @returns {{text: string, value: number}|null}
 */
export function convert(text) {
    const match = text.trim().toLowerCase().replace(/,/g, '.').match(/^(-?\d+\.?\d*)\s*([a-z°/]+)\s*(?:to|in|into|=|->|→)\s*([a-z°/]+)$/);
    if (!match)
        return null;
    const value = Number(match[1]);
    const from = match[2];
    const to = match[3];
    if (from in TEMPERATURE && to in TEMPERATURE) {
        const result = fromCelsius(toCelsius(value, TEMPERATURE[from]), TEMPERATURE[to]);
        return {value: result, text: `${formatNumber(value)} ${from} = ${formatNumber(Math.round(result * 1000) / 1000)} ${to}`};
    }
    for (const table of Object.values(UNITS)) {
        if (from in table && to in table) {
            const result = value * table[from] / table[to];
            return {value: result, text: `${formatNumber(value)} ${from} = ${formatNumber(Math.round(result * 1e6) / 1e6)} ${to}`};
        }
    }
    return null;
}

/** How well `query` matches `name` (0: not at all): a prefix beats a word start beats a substring beats letters in order. */
export function matchScore(name, query) {
    const n = name.toLowerCase();
    const q = query.toLowerCase().trim();
    if (!q)
        return 0;
    if (n === q)
        return 100;
    if (n.startsWith(q))
        return 80;
    if (n.split(/[\s\-_.]+/).some(word => word.startsWith(q)))
        return 60;
    if (n.includes(q))
        return 40;
    // the letters of the query in order and close together ("vscd" finds "VS Code")
    if (q.length < 3)
        return 0;
    let at = 0;
    let first = -1;
    for (const ch of q) {
        at = n.indexOf(ch, at);
        if (at < 0)
            return 0;
        if (first < 0)
            first = at;
        at++;
    }
    return at - first <= q.length + 1 ? 20 : 0;
}
