// Frames up to upright: the upstream solar code ends the tilt of frames on flat ground and flat roofs at 45°. A
// module standing steeper (60–90°, e.g. an upright bifacial fence in the garden) needs what a low one does not:
// what lies on its glass (frame, cell grid, live glow, power text) is lifted along the module's own normal, not the
// face's (upright, the face's normal runs in the glass); its back posts stand behind it, not in it; in the plan it
// keeps a strip to grab; in the 3D pane it is grabbed on its modules, not where the ray meets the ground behind them.
// Pure (no three.js); patch `steepFrames` in tasks.ts.

export type V3 = [number, number, number];
export type Vec2 = [number, number];

/** The steepest frame on flat ground or a flat roof (°): upright. */
export const FRAME_TILT_MAX = 90;

/** In the plan a module is at least this deep (m): an upright one is only a line seen from above. */
export const PLAN_DEPTH_MIN = 0.3;

/** How far the back posts of an upright module stand behind it (m), and from which tilt on they step back. */
export const POSTS_BEHIND = 0.04;
const BEHIND_FROM = 80;

const DEG = Math.PI / 180;

/** What the normal of a module depends on: the face's normal and its axis up the slope. */
export interface FrameFace {
    n: readonly number[];
    es: readonly number[];
    flat: boolean;
    wall?: unknown;
}

/** The tilt of a field's modules (radians) as solar.ts sets them: frames on flat faces (15° by default), off a wall. */
export function frameTilt(face: FrameFace, tilt: number | null | undefined): number {
    if (face.flat) {
        return Math.min(FRAME_TILT_MAX, Math.max(0, tilt ?? 15)) * DEG;
    }
    if (face.wall) {
        return Math.min(90, Math.max(0, tilt ?? 0)) * DEG;
    }
    return 0;
}

/**
 * Where the glass of a field's modules looks: the face's normal turned by the tilt towards the lower edge of the
 * modules (−s, flipped +s). On a sloped roof the modules lie in the face: its normal.
 */
export function moduleNormal(face: FrameFace, field: { tilt?: number | null; flip?: boolean | null }): V3 {
    const t = frameTilt(face, field.tilt);
    const c = Math.cos(t);
    const s = Math.sin(t) * (field.flip ? 1 : -1);
    return [face.n[0] * c + face.es[0] * s, face.n[1] * c + face.es[1] * s, face.n[2] * c + face.es[2] * s];
}

/**
 * The posts of a frame on a flat face at the positions `us` along the eave: under the lower edge (at `sl`) up to it,
 * under the upper edge (at `sh`) up to that. From 80° on the back posts step behind the module (4 cm when upright,
 * where they would stand in its glass) and hold its upper edge with a short arm.
 */
export function framePosts(
    at: (u: number, s: number, up: number) => V3,
    us: readonly number[],
    sl: number,
    sh: number,
    lo: number,
    hi: number,
    tilt: number,
    flip: boolean,
): [V3, V3][] {
    const from = BEHIND_FROM * DEG;
    const off = tilt > from ? POSTS_BEHIND * Math.min(1, (tilt - from) / (Math.PI / 2 - from)) : 0;
    const sb = sh + (flip ? -off : off);
    return us.flatMap(u => {
        const posts: [V3, V3][] = [
            [at(u, sl, 0), at(u, sl, lo)],
            [at(u, sb, 0), at(u, sb, hi)],
        ];
        if (off > 0.001) {
            posts.push([at(u, sb, hi), at(u, sh, hi)]);
        }
        return posts;
    });
}

/**
 * A module of a frame on a flat face in the plan: its outline seen from above (corners: lower edge, then upper edge
 * as solar.ts lists them), and when that is thinner than 30 cm, a strip of 30 cm from its lower edge backwards, where
 * its posts stand.
 */
export function framePlan(corners: readonly (readonly number[])[], es: readonly number[], flip: boolean): Vec2[] {
    const pts = corners.map(p => [p[0], p[2]] as Vec2);
    const l = Math.hypot(es[0], es[2]);
    if (l < 1e-9 || pts.length !== 4) {
        return pts;
    }
    const dir: Vec2 = [es[0] / l, es[2] / l];
    const along = pts.map(p => p[0] * dir[0] + p[1] * dir[1]);
    const depth = Math.max(...along) - Math.min(...along);
    if (depth >= PLAN_DEPTH_MIN) {
        return pts;
    }
    const back = (flip ? -1 : 1) * (PLAN_DEPTH_MIN - depth);
    return pts.map((p, i) => (i < 2 ? p : [p[0] + dir[0] * back, p[1] + dir[1] * back]));
}

/** Where a ray (origin, direction) meets a triangle, both sides: the distance along it, null when it misses. */
function rayTriangle(
    o: readonly number[],
    d: readonly number[],
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
): number | null {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) {
        return null;
    }
    const inv = 1 / det;
    const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
    if (u < 0 || u > 1) {
        return null;
    }
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
    if (v < 0 || u + v > 1) {
        return null;
    }
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
    return t > 0 ? t : null;
}

/** The nearest distance along a ray at which it meets the glass of one of the modules, null when it misses them all. */
export function rayOnModules(
    modules: readonly { corners: readonly (readonly number[])[] }[],
    o: readonly number[],
    d: readonly number[],
): number | null {
    let best: number | null = null;
    for (const m of modules) {
        const [a, b, c, e] = m.corners;
        for (const t of [rayTriangle(o, d, a, b, c), rayTriangle(o, d, a, c, e)]) {
            if (t !== null && (best === null || t < best)) {
                best = t;
            }
        }
    }
    return best;
}
