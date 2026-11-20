// A balcony cut into the roof (Dacheinschnitt): the slope opens over it, and along its edges that do not lie at a
// room's wall a wall stands from the deck up under the roof – the cheeks at the sides, the parapet in front. Pure
// (no three.js).

type P = [number, number];
/** The roof's underside over a plan point in the floor's heights (null: no roof there). */
type Under = (x: number, z: number) => number | null;

let under: Under | null = null;

/** The roof over the floor being built (set by the viewer before each floor, null when it has none). */
export function setRoofUnder(fn: Under | null): void {
    under = fn;
}

/** The roof's underside at a point of the floor being built, null without a roof. */
export function roofAt(x: number, z: number): number | null {
    return under ? under(x, z) : null;
}

export interface CheekPiece {
    a: P;
    b: P;
    /** The roof's underside over a and b. */
    ya: number;
    yb: number;
}

/**
 * The wall along an edge in pieces of at most `step` m, each up to the roof over its ends; only where there is a
 * roof above the deck (`deck`: the deck's top).
 */
export function cheekPieces(p: P, q: P, deck: number, step = 1, fn: Under | null = under): CheekPiece[] {
    if (!fn) {
        return [];
    }
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.max(1, Math.ceil(len / step));
    const at = (t: number): P => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const out: CheekPiece[] = [];
    for (let i = 0; i < n; i++) {
        const a = at(i / n);
        const b = at((i + 1) / n);
        const ya = fn(a[0], a[1]);
        const yb = fn(b[0], b[1]);
        if (ya === null || yb === null || Math.max(ya, yb) < deck + 0.05) {
            continue;
        }
        out.push({ a, b, ya, yb });
    }
    return out;
}

/** Whether the wall along an edge stands at least a railing high (`rail` above the deck) all along it. */
export function cheekHigh(pieces: readonly CheekPiece[], deck: number, rail: number, len: number): boolean {
    if (!pieces.length) {
        return false;
    }
    const covered = pieces.reduce((s, c) => s + Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]), 0);
    return covered >= len - 0.05 && pieces.every(c => Math.min(c.ya, c.yb) >= deck + rail - 0.05);
}

/**
 * The footprint of a wall along the edge a → b of a counter-clockwise outline (x, z), `t` thick, outside it (its
 * outward side lies at (dz, −dx)).
 */
export function cheekFoot(a: P, b: P, t: number): P[] {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n: P = [((b[1] - a[1]) / l) * t, (-(b[0] - a[0]) / l) * t];
    return [a, [a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], b];
}

/** The hole over a cut balcony in a roof section's (u, v): the box around its corners there. */
export function cutHole(uv: readonly P[]): { u0: number; u1: number; v0: number; v1: number } {
    return {
        u0: Math.min(...uv.map(p => p[0])),
        u1: Math.max(...uv.map(p => p[0])),
        v0: Math.min(...uv.map(p => p[1])),
        v1: Math.max(...uv.map(p => p[1])),
    };
}
