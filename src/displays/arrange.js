/**
 * Where monitors stand next to each other: plain rectangles {id, x, y, w, h} on the desktop (no GNOME here, so it can
 * be checked anywhere). GNOME wants every monitor to touch another one along an edge, and none to overlap.
 */

export const SIDES = ['left', 'right', 'above', 'below'];

export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Whether two rectangles share a piece of an edge (touching at a corner only is not enough). */
export function touches(a, b) {
    const sideBySide = (a.x + a.w === b.x || b.x + b.w === a.x) && a.y < b.y + b.h && b.y < a.y + a.h;
    const stacked = (a.y + a.h === b.y || b.y + b.h === a.y) && a.x < b.x + b.w && b.x < a.x + a.w;
    return sideBySide || stacked;
}

/** No overlaps, and every monitor reachable from every other through touching edges. */
export function valid(rects) {
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            if (overlaps(rects[i], rects[j]))
                return false;
        }
    }
    if (rects.length < 2)
        return true;
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
        const i = queue.shift();
        rects.forEach((r, j) => {
            if (!seen.has(j) && touches(rects[i], r)) {
                seen.add(j);
                queue.push(j);
            }
        });
    }
    return seen.size === rects.length;
}

/** The top left monitor's corner at 0,0 (as GNOME keeps it). */
export function normalize(rects) {
    const minX = Math.min(...rects.map(r => r.x));
    const minY = Math.min(...rects.map(r => r.y));
    return rects.map(r => ({...r, x: r.x - minX, y: r.y - minY}));
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Where `m` stands on `side` of `a`, centred along it. */
function beside(m, a, side) {
    switch (side) {
    case 'left': return {x: a.x - m.w, y: Math.round(a.y + (a.h - m.h) / 2)};
    case 'right': return {x: a.x + a.w, y: Math.round(a.y + (a.h - m.h) / 2)};
    case 'above': return {x: Math.round(a.x + (a.w - m.w) / 2), y: a.y - m.h};
    default: return {x: Math.round(a.x + (a.w - m.w) / 2), y: a.y + a.h};
    }
}

/**
 * Puts monitor `id` on a side of monitor `anchorId` (the main one, say). A monitor already standing there is gone round:
 * the moved one goes on the same side of that one. @returns {object[]|null} the new rectangles, or null if it cannot be
 */
export function placeSide(rects, id, side, anchorId) {
    const m = rects.find(r => r.id === id);
    let anchor = rects.find(r => r.id === anchorId);
    if (!m || !anchor || id === anchorId)
        return null;
    const others = rects.filter(r => r.id !== id);
    for (let tries = 0; tries <= others.length; tries++) {
        const moved = {...m, ...beside(m, anchor, side)};
        const blocker = others.find(o => overlaps(o, moved));
        if (!blocker) {
            const result = normalize(rects.map(r => (r.id === id ? moved : r)));
            return valid(result) ? result : null;
        }
        anchor = blocker;
    }
    return null;
}

/** Which side of `a` monitor `b` stands on (the one they share the most of), or null if they do not touch. */
export function sideOf(b, a) {
    if (!touches(a, b))
        return null;
    if (b.x + b.w === a.x)
        return 'left';
    if (b.x === a.x + a.w)
        return 'right';
    if (b.y + b.h === a.y)
        return 'above';
    return 'below';
}

/**
 * A monitor dropped (dragged) with its corner at x, y: it goes flush against the nearest edge of another monitor, its
 * edges catching on the other's edges and middle when near. @param {number} snap how near is near (desktop pixels)
 * @returns {object[]|null} the new rectangles, or null if it fits nowhere
 */
export function dropAt(rects, id, x, y, snap = 120) {
    const m = rects.find(r => r.id === id);
    if (!m)
        return null;
    const others = rects.filter(r => r.id !== id);
    const catchOn = (value, targets) => {
        let best = value;
        let distance = snap;
        for (const t of targets) {
            if (Math.abs(t - value) < distance) {
                distance = Math.abs(t - value);
                best = t;
            }
        }
        return best;
    };
    let best = null;
    for (const o of others) {
        // along the edge it must share at least a little of it
        const minY = o.y - m.h + 1;
        const maxY = o.y + o.h - 1;
        const minX = o.x - m.w + 1;
        const maxX = o.x + o.w - 1;
        const alongY = clamp(catchOn(y, [o.y, o.y + o.h - m.h, Math.round(o.y + (o.h - m.h) / 2)]), minY, maxY);
        const alongX = clamp(catchOn(x, [o.x, o.x + o.w - m.w, Math.round(o.x + (o.w - m.w) / 2)]), minX, maxX);
        const candidates = [
            {x: o.x - m.w, y: alongY},
            {x: o.x + o.w, y: alongY},
            {x: alongX, y: o.y - m.h},
            {x: alongX, y: o.y + o.h},
        ];
        for (const c of candidates) {
            const moved = {...m, ...c};
            if (others.some(r => overlaps(r, moved)))
                continue;
            const distance = Math.hypot(c.x - x, c.y - y);
            if (!best || distance < best.distance)
                best = {distance, moved};
        }
    }
    if (!best)
        return null;
    const result = normalize(rects.map(r => (r.id === id ? best.moved : r)));
    return valid(result) ? result : null;
}
