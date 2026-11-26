// The corner bathtub ("bathtub_corner", added in tasks.ts by `houseItems`): it stands in a corner of the room, its back
// (-z) and its left side (-x) against the walls, its front cut off from the right end to the front end. Its basin is
// rounded and leaves a deck in the corner for the tap; the water runs in from the spout over the basin's edge.
// Local coordinates as in viewer/furniture.ts: x across, z depth with the front at +z, y up. Pure geometry here,
// drawn with the furniture builder (house-items.ts `ItemDraw`).

import type { ItemDraw, ItemEdges, SymbolDraw } from './house-items';

type P = [number, number];

/** The share of each side the cut front leaves at the right end and at the front end. */
const END = 0.36;
/** The deck in the corner: how far along both walls it reaches, as a share of the side. */
const DECK = 0.3;
/** The rim around the basin, in metres. */
const RIM = 0.08;

/** What the corner bathtub borrows of the furniture colours. */
export interface TubColors {
    white: number;
    whiteTop: number;
    metal: number;
    glass: number;
}

export interface CornerTub {
    /** The tub's outline: five corners, the walls' corner first. */
    outline: P[];
    /** The basin's rounded edge on the rim; null when the tub is too small for one. */
    basin: P[] | null;
    /** Where the tap stands, on the deck in the corner. */
    tap: P;
    /** Where the water falls into the basin. */
    spout: P;
}

/** Twice the signed area of a polygon (positive: counter-clockwise in x/z). */
function area2(poly: readonly P[]): number {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
        const [ax, az] = poly[i];
        const [bx, bz] = poly[(i + 1) % poly.length];
        s += ax * bz - bx * az;
    }
    return s;
}

/**
 * A convex polygon moved inwards by t on every side, with its corners rounded by r (the inset by t + r, each corner
 * then an arc of radius r); null when a side would vanish.
 */
export function roundInset(poly: readonly P[], t: number, r: number): P[] | null {
    const n = poly.length;
    const s = Math.sign(area2(poly));
    if (n < 3 || !s) {
        return null;
    }
    const k = t + r;
    // every side: its direction and its inward normal
    const sides = poly.map((a, i) => {
        const b = poly[(i + 1) % n];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const dx = (b[0] - a[0]) / len;
        const dz = (b[1] - a[1]) / len;
        return { a, dx, dz, nx: -dz * s, nz: dx * s };
    });
    const corners: P[] = [];
    for (let i = 0; i < n; i++) {
        const p = sides[(i + n - 1) % n];
        const q = sides[i];
        const cross = p.dx * q.dz - p.dz * q.dx;
        if (Math.abs(cross) < 1e-9) {
            return null;
        }
        // where the two moved sides meet
        const px = p.a[0] + p.nx * k;
        const pz = p.a[1] + p.nz * k;
        const qx = q.a[0] + q.nx * k;
        const qz = q.a[1] + q.nz * k;
        const u = ((qx - px) * q.dz - (qz - pz) * q.dx) / cross;
        corners.push([px + p.dx * u, pz + p.dz * u]);
    }
    // every moved side keeps its direction, or it has vanished
    for (let i = 0; i < n; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % n];
        if ((b[0] - a[0]) * sides[i].dx + (b[1] - a[1]) * sides[i].dz < 1e-4) {
            return null;
        }
    }
    if (r <= 0) {
        return corners;
    }
    const out: P[] = [];
    for (let i = 0; i < n; i++) {
        const p = sides[(i + n - 1) % n];
        const q = sides[i];
        const a0 = Math.atan2(-p.nz, -p.nx);
        let turn = Math.atan2(-q.nz, -q.nx) - a0;
        // the outward normals turn the way the polygon runs
        while (s * turn < 0) {
            turn += s * 2 * Math.PI;
        }
        const steps = Math.max(1, Math.ceil(Math.abs(turn) / (Math.PI / 8)));
        const [cx, cz] = corners[i];
        for (let j = 0; j <= steps; j++) {
            const a = a0 + (turn * j) / steps;
            out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
        }
    }
    return out;
}

/** The shape of a corner bathtub in its w × d box. */
export function cornerTub(w: number, d: number): CornerTub {
    const x0 = -w / 2;
    const z0 = -d / 2;
    const outline: P[] = [
        [x0, z0],
        [w / 2, z0],
        [w / 2, z0 + d * END],
        [x0 + w * END, d / 2],
        [x0, d / 2],
    ];
    // the basin: the outline without the deck in the corner, inside the rim, its corners rounded
    const deck: P[] = [[x0 + w * DECK, z0], ...outline.slice(1), [x0, z0 + d * DECK]];
    const r = Math.min(0.2, Math.min(w, d) * 0.14);
    const basin = roundInset(deck, RIM, r) ?? roundInset(deck, RIM, 0);
    const tap: P = [x0 + w * DECK * 0.5, z0 + d * DECK * 0.5];
    // the spout reaches from the tap towards the middle of the basin, over its edge
    const mid = basin ?? outline;
    const mx = mid.reduce((sum, p) => sum + p[0], 0) / mid.length;
    const mz = mid.reduce((sum, p) => sum + p[1], 0) / mid.length;
    const len = Math.hypot(mx - tap[0], mz - tap[1]) || 1;
    const reach = Math.min(0.16, len * 0.6);
    return {
        outline,
        basin,
        tap,
        spout: [tap[0] + ((mx - tap[0]) / len) * reach, tap[1] + ((mz - tap[1]) / len) * reach],
    };
}

/** A closed line through the points at height y. */
function loop(b: ItemDraw, pts: readonly P[], y: number, color: ItemEdges['furn']): void {
    for (let i = 0; i < pts.length; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[(i + 1) % pts.length];
        b.seg(ax, y, az, bx, y, bz, color);
    }
}

/** A corner bathtub of height h: the white tub, its rim round the basin, the water in it, the tap with its spout. */
export function cornerBathtub(b: ItemDraw, c: TubColors, e: ItemEdges, w: number, d: number, h: number): void {
    const { outline, basin, tap, spout } = cornerTub(w, d);
    const low = Math.max(0.05, h - 0.04);
    const water = h - 0.025;
    b.prism(outline, 0, low, c.white, c.whiteTop);
    if (basin) {
        // the rim with the basin left open, the water 2.5 cm below its edge
        b.prism(outline, low, h, c.white, c.whiteTop, null, [basin]);
        b.prism(basin, low, water, c.glass, c.glass);
        loop(b, basin, water, e.glow);
    } else {
        b.prism(outline, low, h, c.white, c.whiteTop);
    }
    loop(b, outline, h, e.furn);
    for (const [x, z] of outline) {
        b.seg(x, 0, z, x, h, z, e.furn);
    }
    // the tap, and its spout bent over towards the basin
    b.cyl(tap[0], tap[1], 0.02, h, h + 0.12, c.metal, c.metal, 8);
    const dx = spout[0] - tap[0];
    const dz = spout[1] - tap[1];
    const len = Math.hypot(dx, dz) || 1;
    const [nx, nz] = [(-dz / len) * 0.012, (dx / len) * 0.012];
    const tip: P = [tap[0] + dx * 0.85, tap[1] + dz * 0.85];
    b.prism(
        [
            [tap[0] + nx, tap[1] + nz],
            [tip[0] + nx, tip[1] + nz],
            [tip[0] - nx, tip[1] - nz],
            [tap[0] - nx, tap[1] - nz],
        ],
        h + 0.09,
        h + 0.115,
        c.metal,
        c.metal,
    );
}

/** The plan symbol: the tub's outline, the basin and the tap. */
export function cornerTubSymbol<T>(w: number, d: number, s: SymbolDraw<T>): T[] {
    const { outline, basin, tap } = cornerTub(w, d);
    const out: T[] = [];
    const ring = (pts: readonly P[], cls?: string): void => {
        for (let i = 0; i < pts.length; i++) {
            const [ax, az] = pts[i];
            const [bx, bz] = pts[(i + 1) % pts.length];
            out.push(s.line(ax, az, bx, bz, cls));
        }
    };
    ring(outline, 'fp3d-sym-strong');
    if (basin) {
        ring(basin);
    }
    out.push(s.rect(tap[0] - 0.03, tap[1] - 0.03, tap[0] + 0.03, tap[1] + 0.03, 'fp3d-sym-fill'));
    return out;
}
