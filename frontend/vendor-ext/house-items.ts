// Furniture of the house the 3D frontend did not have (furniture types added in tasks.ts, `houseItems`):
// - "stairs_spiral": a spiral stair around a pole, one turn per storey; its last tread is the landing in the round
//   opening it cuts into the floor above (spiralHole);
// - "fireplace": a wood stove with a glass door, the embers behind it and its flue pipe up to the item's height;
// - "chimney": a brick chimney with its cap and flue pot (it can be lifted to stand on the roof or a floor);
// - "sauna": a cabin of boards, open at the top like the rooms, with a glass door, two benches and the stove;
// - "railing": a straight railing of bars between posts under a wooden handrail (a gallery, a stairwell's edge);
// - "stairs_outdoor": solid steps of stone outside (granite steps down a garden), rising towards the back;
// - "light_well": a concrete well in front of a cellar window with a grate on top, its back against the house wall;
//   it cuts its hole into the area outside around it (wellHoles), so it shows in a hill as well.
// Built with the low-poly furniture builder of viewer/furniture.ts (local coordinates: x across, z depth with the
// front at +z, y up), in its colours; the colours of their own come in a neon and a natural twin.

import type { Color } from 'three';
import { inside } from './rail-spans';

type P = [number, number];

/** The builder of viewer/furniture.ts, as far as these items use it (`prism` is added by the patch). */
export interface ItemDraw {
    box(
        x0: number,
        x1: number,
        y0: number,
        y1: number,
        z0: number,
        z1: number,
        side: number,
        top?: number,
        edges?: Color | null,
    ): void;
    cyl(
        cx: number,
        cz: number,
        r: number,
        y0: number,
        y1: number,
        side: number,
        top?: number,
        n?: number,
        edges?: Color | null,
    ): void;
    seg(xa: number, ya: number, za: number, xb: number, yb: number, zb: number, color?: Color): void;
    /** An upright prism over a polygon; `holes` are left open in it (the basin in a corner bathtub's rim). */
    prism(pts: P[], y0: number, y1: number, side: number, top?: number, edges?: Color | null, holes?: P[][]): void;
}

/** The furniture colours these items borrow. */
export interface BaseColors {
    wood: number;
    woodTop: number;
    metal: number;
    dark: number;
    glass: number;
}

/** Their own colours. */
export interface HouseColors {
    stove: number;
    stoveTop: number;
    brick: number;
    brickTop: number;
    stone: number;
    stoneTop: number;
    sauna: number;
    saunaTop: number;
    ember: number;
    concrete: number;
    concreteTop: number;
}

/** The outline colours of the furniture: main edges, faint ones, glowing ones. */
export interface ItemEdges {
    furn: Color;
    faint: Color;
    glow: Color;
}

export const HOUSE_NEON: HouseColors = {
    stove: 0x0f1626,
    stoveTop: 0x16203a,
    brick: 0x2a2036,
    brickTop: 0x33284a,
    stone: 0x232c42,
    stoneTop: 0x2b3650,
    sauna: 0x1f2a40,
    saunaTop: 0x283656,
    ember: 0xff7a2a,
    concrete: 0x1d2638,
    concreteTop: 0x26314a,
};

export const HOUSE_NATURAL: HouseColors = {
    stove: 0x2e3238,
    stoveTop: 0x3a3f46,
    brick: 0x9a5a44,
    brickTop: 0xa86a52,
    stone: 0x8f9296,
    stoneTop: 0xa3a6aa,
    sauna: 0xc9a27a,
    saunaTop: 0xd8b48c,
    ember: 0xff8a3a,
    concrete: 0x9c9c98,
    concreteTop: 0xb0b0ab,
};

export const HOUSE_ITEMS = [
    'stairs_spiral',
    'fireplace',
    'chimney',
    'sauna',
    'railing',
    'stairs_outdoor',
    'light_well',
] as const;

/** A point at radius r and angle a around the pole: a = 0 points to the front (+z), it turns towards +x. */
const around = (r: number, a: number): P => [Math.sin(a) * r, Math.cos(a) * r];

/** The layout of a spiral stair of height h in a w × d box: its radius, the risers and the angle of one tread. */
export function spiralLayout(
    w: number,
    d: number,
    h: number,
): { r: number; n: number; rise: number; step: number; pole: number } {
    const r = Math.max(0.3, Math.min(w, d) / 2);
    const n = Math.max(6, Math.round(h / 0.19));
    // one turn per storey: n treads and the landing, which takes two treads' room
    return { r, n, rise: h / n, step: (2 * Math.PI) / (n + 1), pole: Math.min(0.06, r * 0.12) };
}

/** A spiral stair: the pole, wedge-shaped treads up to the landing at h, the handrail along the outer edge. */
export function spiralStairs(b: ItemDraw, c: BaseColors, e: ItemEdges, w: number, d: number, h: number): void {
    const { r, n, rise, step, pole } = spiralLayout(w, d, h);
    const rail = 0.9;
    b.cyl(0, 0, pole, 0, h + rail, c.metal, c.metal, 12);
    for (let i = 0; i < n; i++) {
        const a0 = step * i;
        // a small overlap under the next tread; the last one is the landing, twice as wide
        const a1 = step * (i + 1) + (i === n - 1 ? step : 0.05);
        const y1 = rise * (i + 1);
        const pts: P[] = [around(pole * 0.9, a0)];
        const k = 4;
        for (let j = 0; j <= k; j++) {
            pts.push(around(r, a0 + ((a1 - a0) * j) / k));
        }
        pts.push(around(pole * 0.9, a1));
        b.prism(pts, y1 - 0.045, y1, c.wood, c.woodTop);
        // the nosing, and a baluster at the outer edge
        const [nx, nz] = around(r, a0);
        b.seg(0, y1, 0, nx, y1, nz, e.furn);
        const [bx, bz] = around(r - 0.03, a0 + step / 2);
        b.seg(bx, y1, bz, bx, y1 + rail, bz, e.faint);
    }
    // the handrail: a helix over the outer edge from the first tread, level over the landing
    const parts = n * 3;
    let prev: [number, number, number] | null = null;
    for (let i = 0; i <= parts; i++) {
        const a = step / 2 + (step * n * i) / parts;
        const [x, z] = around(r - 0.03, a);
        const y = Math.min(h, rise * (a / step + 0.5)) + rail;
        if (prev) {
            b.seg(prev[0], prev[1], prev[2], x, y, z, e.glow);
        }
        prev = [x, y, z];
    }
}

/** The round opening a spiral stair needs in the floor above (plan coordinates, as the item's footprint runs). */
export function spiralHole(f: { x: number; z: number; w: number; d: number; h: number }): P[] {
    const { r } = spiralLayout(f.w, f.d, f.h);
    const out: P[] = [];
    for (let i = 0; i < 20; i++) {
        const t = (i / 20) * Math.PI * 2;
        out.push([f.x + Math.cos(t) * (r + 0.05), f.z + Math.sin(t) * (r + 0.05)]);
    }
    return out;
}

/** A wood stove: plinth, body, top plate, the glass door with the embers behind it, the flue pipe up to h. */
export function woodStove(
    b: ItemDraw,
    c: BaseColors,
    hc: HouseColors,
    e: ItemEdges,
    w: number,
    d: number,
    h: number,
): void {
    const body = Math.min(h, 1.15);
    const plinth = Math.min(0.08, body * 0.08);
    b.box(-w / 2 + 0.03, w / 2 - 0.03, 0, plinth, -d / 2 + 0.03, d / 2 - 0.03, c.dark, c.dark);
    b.box(-w / 2, w / 2, plinth, body - 0.03, -d / 2, d / 2, hc.stove, hc.stoveTop, e.furn);
    b.box(
        -w / 2 - 0.01,
        w / 2 + 0.01,
        body - 0.03,
        body,
        -d / 2 - 0.01,
        d / 2 + 0.01,
        hc.stoveTop,
        hc.stoveTop,
        e.furn,
    );
    const gx = w * 0.36;
    const g0 = plinth + (body - plinth) * 0.3;
    const g1 = plinth + (body - plinth) * 0.82;
    // the door's frame, the embers on the floor of the fire box and the glass in front of them
    b.box(-gx - 0.025, gx + 0.025, g0 - 0.025, g1 + 0.025, d / 2, d / 2 + 0.012, c.metal, c.metal);
    b.box(-gx * 0.75, gx * 0.75, g0 + 0.01, g0 + 0.07, d / 2 + 0.012, d / 2 + 0.016, hc.ember, hc.ember);
    b.box(-gx, gx, g0, g1, d / 2 + 0.016, d / 2 + 0.02, c.glass, c.glass, e.glow);
    // the ash drawer below the door
    b.box(-gx, gx, plinth + 0.03, g0 - 0.06, d / 2, d / 2 + 0.008, c.dark, c.dark);
    if (h > body + 0.05) {
        b.cyl(0, -d * 0.1, Math.min(0.075, w * 0.15), body, h, c.metal, c.metal, 12);
    }
}

/** A brick chimney: the stack with faint courses, a stone cap and the flue pot on top. */
export function chimney(b: ItemDraw, hc: HouseColors, e: ItemEdges, w: number, d: number, h: number): void {
    const cap = Math.min(0.08, h * 0.1);
    b.box(-w / 2, w / 2, 0, h - cap, -d / 2, d / 2, hc.brick, hc.brickTop, e.furn);
    b.box(-w / 2 - 0.04, w / 2 + 0.04, h - cap, h, -d / 2 - 0.04, d / 2 + 0.04, hc.stone, hc.stoneTop, e.furn);
    b.cyl(0, 0, Math.min(w, d) * 0.18, h, h + 0.18, hc.stone, hc.stoneTop, 10);
    for (let y = 0.25; y < h - cap - 0.05; y += 0.25) {
        b.seg(-w / 2, y, d / 2, w / 2, y, d / 2, e.faint);
        b.seg(-w / 2, y, -d / 2, w / 2, y, -d / 2, e.faint);
        b.seg(-w / 2, y, -d / 2, -w / 2, y, d / 2, e.faint);
        b.seg(w / 2, y, -d / 2, w / 2, y, d / 2, e.faint);
    }
}

/**
 * A sauna cabin: walls of boards (open at the top like the rooms, so the benches show from above), a glass door at
 * the front on the left, the upper bench along the back, the lower one in front of it and the stove in the front
 * right corner.
 */
export function sauna(
    b: ItemDraw,
    c: BaseColors,
    hc: HouseColors,
    e: ItemEdges,
    w: number,
    d: number,
    h: number,
): void {
    const t = 0.06;
    const x0 = -w / 2;
    const x1 = w / 2;
    const z0 = -d / 2;
    const z1 = d / 2;
    const doorW = Math.max(0.4, Math.min(0.7, w - 0.5));
    const dx0 = x0 + Math.min(0.2, (w - doorW) / 3);
    const dx1 = dx0 + doorW;
    const doorH = Math.min(1.9, h - 0.1);
    // the back, the sides, the front beside the door and over it
    b.box(x0, x1, 0, h, z0, z0 + t, hc.sauna, hc.saunaTop, e.furn);
    b.box(x0, x0 + t, 0, h, z0 + t, z1, hc.sauna, hc.saunaTop, e.furn);
    b.box(x1 - t, x1, 0, h, z0 + t, z1, hc.sauna, hc.saunaTop, e.furn);
    b.box(x0 + t, dx0, 0, h, z1 - t, z1, hc.sauna, hc.saunaTop, e.furn);
    b.box(dx1, x1 - t, 0, h, z1 - t, z1, hc.sauna, hc.saunaTop, e.furn);
    b.box(dx0, dx1, doorH, h, z1 - t, z1, hc.sauna, hc.saunaTop, e.furn);
    b.box(dx0, dx1, 0.01, doorH, z1 - t / 2 - 0.006, z1 - t / 2 + 0.006, c.glass, c.glass, e.glow);
    // the boards on the outside
    for (let x = x0 + 0.15; x < x1 - 0.05; x += 0.15) {
        b.seg(x, 0.02, z0 - 0.001, x, h, z0 - 0.001, e.faint);
        if (x < dx0 - 0.02 || x > dx1 + 0.02) {
            b.seg(x, 0.02, z1 + 0.001, x, h, z1 + 0.001, e.faint);
        }
    }
    for (let z = z0 + 0.15; z < z1 - 0.05; z += 0.15) {
        b.seg(x0 - 0.001, 0.02, z, x0 - 0.001, h, z, e.faint);
        b.seg(x1 + 0.001, 0.02, z, x1 + 0.001, h, z, e.faint);
    }
    // the benches: the upper one along the back, the lower one in front of it (it keeps clear of the stove)
    const upper = Math.min(1.0, h * 0.5);
    const lower = upper * 0.48;
    const zu = Math.min(z0 + t + 0.6, z1 - t - 0.3);
    const zl = Math.max(zu, Math.min(z0 + t + 1.1, z1 - t - 0.55));
    b.box(x0 + t, x1 - t, upper - 0.04, upper, z0 + t, zu, c.wood, c.woodTop, e.furn);
    b.box(x0 + t, x1 - t, lower, upper - 0.04, zu - 0.02, zu, c.wood, c.wood);
    if (zl > zu + 0.05) {
        b.box(x0 + t, x1 - t, lower - 0.04, lower, zu, zl, c.wood, c.woodTop, e.furn);
        b.box(x0 + t, x1 - t, 0, lower - 0.04, zl - 0.02, zl, c.wood, c.wood);
    }
    // the stove with its stones in the front right corner
    const sx = x1 - t - 0.25;
    const sz = z1 - t - 0.24;
    const sh = Math.min(0.72, h * 0.36);
    b.box(sx - 0.2, sx + 0.2, 0, sh, sz - 0.18, sz + 0.18, hc.stove, hc.stoveTop, e.furn);
    for (const [ox, oz] of [
        [-0.09, -0.08],
        [0.08, -0.07],
        [-0.07, 0.08],
        [0.09, 0.07],
        [0, 0],
    ] as P[]) {
        b.box(sx + ox - 0.06, sx + ox + 0.06, sh, sh + 0.07, sz + oz - 0.06, sz + oz + 0.06, hc.stone, hc.stoneTop);
    }
}

/** A railing along its width: posts at most 1.5 m apart, bars every 12 cm, a bottom rail and the wooden handrail. */
export function railing(b: ItemDraw, c: BaseColors, e: ItemEdges, w: number, d: number, h: number): void {
    const t = Math.min(d, 0.05);
    const x0 = -w / 2;
    const x1 = w / 2;
    const posts = Math.max(1, Math.ceil(w / 1.5));
    for (let i = 0; i <= posts; i++) {
        const x = x0 + (w * i) / posts;
        b.box(Math.max(x0, x - 0.02), Math.min(x1, x + 0.02), 0, h - 0.045, -t / 2, t / 2, c.metal, c.metal, e.furn);
    }
    b.box(x0, x1, h - 0.045, h, -t / 2 - 0.005, t / 2 + 0.005, c.wood, c.woodTop, e.furn);
    b.box(x0, x1, 0.08, 0.11, -0.012, 0.012, c.metal, c.metal);
    const n = Math.max(2, Math.round(w / 0.12));
    for (let i = 1; i < n; i++) {
        const x = x0 + (w * i) / n;
        b.box(x - 0.008, x + 0.008, 0.11, h - 0.045, -0.008, 0.008, c.metal, c.metal);
    }
}

/** Steps of stone outside: solid, rising towards the back (-z) like the straight stair, about 16 cm each. */
export function outdoorSteps(b: ItemDraw, hc: HouseColors, e: ItemEdges, w: number, d: number, h: number): void {
    const n = Math.max(2, Math.round(h / 0.16));
    const rise = h / n;
    const run = d / n;
    for (let i = 0; i < n; i++) {
        const z1 = d / 2 - run * i;
        const y1 = rise * (i + 1);
        b.box(-w / 2, w / 2, 0, y1, z1 - run, z1, hc.stone, hc.stoneTop);
        b.seg(-w / 2, y1, z1, w / 2, y1, z1, e.furn);
    }
    b.seg(-w / 2, 0, d / 2, -w / 2, rise, d / 2, e.furn);
    b.seg(w / 2, 0, d / 2, w / 2, rise, d / 2, e.furn);
    for (const x of [-w / 2, w / 2]) {
        b.seg(x, rise, d / 2, x, h, -d / 2 + run, e.faint);
    }
}

/**
 * A light well: its walls of concrete on both sides and at the front (the back is the house wall), gravel at the
 * bottom and the grate on top at h, bars running out from the wall.
 */
export function lightWell(
    b: ItemDraw,
    c: BaseColors,
    hc: HouseColors,
    e: ItemEdges,
    w: number,
    d: number,
    h: number,
): void {
    const t = Math.min(0.08, w / 6, d / 4);
    const x0 = -w / 2;
    const x1 = w / 2;
    const z0 = -d / 2;
    const z1 = d / 2;
    b.box(x0, x0 + t, 0, h, z0, z1, hc.concrete, hc.concreteTop, e.furn);
    b.box(x1 - t, x1, 0, h, z0, z1, hc.concrete, hc.concreteTop, e.furn);
    b.box(x0 + t, x1 - t, 0, h, z1 - t, z1, hc.concrete, hc.concreteTop, e.furn);
    b.box(x0 + t, x1 - t, 0, 0.05, z0, z1 - t, c.dark, c.dark);
    // the grate: a bar along the wall, one along the front and the bars between them
    const g0 = h - 0.03;
    b.box(x0 + t, x1 - t, g0, h, z0, z0 + 0.025, c.metal, c.metal);
    b.box(x0 + t, x1 - t, g0, h, z1 - t - 0.025, z1 - t, c.metal, c.metal);
    const n = Math.max(3, Math.round((w - 2 * t) / 0.1));
    for (let i = 1; i < n; i++) {
        const x = x0 + t + ((w - 2 * t) * i) / n;
        b.box(x - 0.006, x + 0.006, g0, h, z0, z1 - t, c.metal, c.metal);
    }
}

/** A point moved towards `c` until it lies inside `poly` with a centimetre to spare (null if it is not within 0.5 m). */
function pullInside(p: P, c: P, poly: readonly P[]): P | null {
    const len = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1;
    for (let k = 0; k <= 50; k++) {
        const t = Math.min(1, (k * 0.01) / len);
        const q: P = [p[0] + (c[0] - p[0]) * t, p[1] + (c[1] - p[1]) * t];
        if (inside(q, poly)) {
            const t2 = Math.min(1, ((k + 1) * 0.01) / len);
            return [p[0] + (c[0] - p[0]) * t2, p[1] + (c[1] - p[1]) * t2];
        }
    }
    return null;
}

/**
 * The holes the light wells of a floor cut into an area outside lying around them (a lawn on a hill in front of the
 * cellar windows): each well's footprint, pulled just inside the area where it reaches its edge (the house wall).
 */
export function wellHoles<F extends { type: string; x: number; z: number }>(
    items: readonly F[],
    area: readonly P[],
    footprint: (f: F) => P[],
): P[][] {
    const out: P[][] = [];
    for (const f of items) {
        if (f.type !== 'light_well' || !inside([f.x, f.z], area)) {
            continue;
        }
        const hole = footprint(f).map(p => pullInside(p, [f.x, f.z], area));
        if (hole.every(p => p !== null)) {
            out.push(hole);
        }
    }
    return out;
}

/** The plan's drawing primitives (lines and rectangles in metres, a CSS class each), whatever they draw. */
export interface SymbolDraw<T> {
    rect(x0: number, z0: number, x1: number, z1: number, cls?: string): T;
    line(x0: number, z0: number, x1: number, z1: number, cls?: string): T;
}

/** The plan symbols of the railing, the outdoor steps and the light well (h = the item's height, 0 = unknown); null for other types. */
export function houseSymbol<T>(type: string, w: number, d: number, h: number, s: SymbolDraw<T>): T[] | null {
    switch (type) {
        case 'railing': {
            // its outline and the posts
            const posts = Math.max(1, Math.ceil(w / 1.5));
            const out = [s.rect(-w / 2, -d / 2, w / 2, d / 2, 'fp3d-sym-strong')];
            for (let i = 0; i <= posts; i++) {
                const x = -w / 2 + (w * i) / posts;
                out.push(s.rect(x - 0.025, -0.025, x + 0.025, 0.025, 'fp3d-sym-fill'));
            }
            return out;
        }
        case 'stairs_outdoor': {
            // the outline, the nosings (one step per 16 cm of height, as drawn in 3D) and an arrow up towards the back
            const n = h > 0 ? Math.max(2, Math.round(h / 0.16)) : Math.max(2, Math.round(d / 0.3));
            const out = [s.rect(-w / 2, -d / 2, w / 2, d / 2, 'fp3d-sym-strong')];
            for (let i = 1; i < n; i++) {
                out.push(s.line(-w / 2, d / 2 - (d / n) * i, w / 2, d / 2 - (d / n) * i));
            }
            const tip = -d / 2 + 0.15;
            out.push(
                s.line(0, d / 2 - 0.1, 0, tip, 'fp3d-sym-strong'),
                s.line(-0.12, tip + 0.17, 0, tip, 'fp3d-sym-strong'),
                s.line(0.12, tip + 0.17, 0, tip, 'fp3d-sym-strong'),
            );
            return out;
        }
        case 'light_well': {
            // its walls (open towards the house at the back) and the bars of the grate
            const t = Math.min(0.08, w / 6, d / 4);
            const out = [
                s.line(-w / 2, -d / 2, -w / 2, d / 2, 'fp3d-sym-strong'),
                s.line(-w / 2, d / 2, w / 2, d / 2, 'fp3d-sym-strong'),
                s.line(w / 2, d / 2, w / 2, -d / 2, 'fp3d-sym-strong'),
            ];
            const n = Math.max(3, Math.round((w - 2 * t) / 0.1));
            for (let i = 1; i < n; i++) {
                const x = -w / 2 + t + ((w - 2 * t) * i) / n;
                out.push(s.line(x, -d / 2, x, d / 2 - t));
            }
            return out;
        }
        default:
            return null;
    }
}
