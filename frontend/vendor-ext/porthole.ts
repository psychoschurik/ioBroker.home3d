// Rounded windows (window style "porthole"): the frame is a plate with a rounded opening that fills the rectangular
// hole in the wall, the sash a rounded ring with its pane. The parts are given as triangles in the opening's own
// coordinates [x along the wall, n towards the room, y up]; the viewer (openings.ts, patched in tasks.ts) turns them
// into its merged window geometry. Without three.js's scene objects, so it can be tested.
import { ShapeUtils, Vector2 } from 'three';

/** A point of an outline in the wall plane: [x, y]. */
export type Pt = [number, number];
/** A triangle in the opening's coordinates [x, n, y]. */
export type Tri = (a: number[], b: number[], c: number[]) => void;

/**
 * A rectangle from x0 … x1, y0 … y1 with its corners rounded as far as they go (half the smaller side): a circle when
 * square, else a slot with round ends. Counter-clockwise, without repeated points.
 */
export function roundedOutline(x0: number, x1: number, y0: number, y1: number, seg = 10): Pt[] {
    const r = Math.max(0.001, Math.min(x1 - x0, y1 - y0) / 2);
    const corners: [number, number, number][] = [
        [x1 - r, y0 + r, -Math.PI / 2],
        [x1 - r, y1 - r, 0],
        [x0 + r, y1 - r, Math.PI / 2],
        [x0 + r, y0 + r, Math.PI],
    ];
    const out: Pt[] = [];
    for (const [cx, cy, a0] of corners) {
        for (let i = 0; i <= seg; i++) {
            const a = a0 + (i / seg) * (Math.PI / 2);
            const p: Pt = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
            const last = out[out.length - 1];
            if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) {
                out.push(p);
            }
        }
    }
    const first = out[0];
    const last = out[out.length - 1];
    if (out.length > 3 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) {
        out.pop();
    }
    return out;
}

/** The same outline shrunk by `d` towards its middle (a ring's inner edge). */
export function insetOutline(x0: number, x1: number, y0: number, y1: number, d: number, seg = 10): Pt[] {
    return roundedOutline(x0 + d, x1 - d, y0 + d, y1 - d, seg);
}

/** The faces of an outline with a hole (or without) at depth n. */
function faces(outer: Pt[], hole: Pt[] | null, n: number, tri: Tri): void {
    const v = (p: Pt): Vector2 => new Vector2(p[0], p[1]);
    const all = hole ? [...outer, ...hole] : outer;
    for (const [a, b, c] of ShapeUtils.triangulateShape(outer.map(v), hole ? [hole.map(v)] : [])) {
        tri([all[a][0], n, all[a][1]], [all[b][0], n, all[b][1]], [all[c][0], n, all[c][1]]);
    }
}

/** The band of an outline between the depths n0 and n1 (the edge of a plate or ring). */
function band(line: Pt[], n0: number, n1: number, tri: Tri): void {
    for (let i = 0; i < line.length; i++) {
        const p = line[i];
        const q = line[(i + 1) % line.length];
        tri([p[0], n0, p[1]], [q[0], n0, q[1]], [q[0], n1, q[1]]);
        tri([p[0], n0, p[1]], [q[0], n1, q[1]], [p[0], n1, p[1]]);
    }
}

/**
 * A plate from n0 to n1: `outer` with `hole` cut out. `face` gets both faces, `side` the edges (the outer edge only
 * when `outerEdge`: a plate in a wall's hole needs none there).
 */
export function plate(
    outer: Pt[],
    hole: Pt[] | null,
    n0: number,
    n1: number,
    face: Tri,
    side: Tri,
    outerEdge: boolean,
): void {
    faces(outer, hole, n0, face);
    faces(outer, hole, n1, face);
    if (hole) {
        band(hole, n0, n1, side);
    }
    if (outerEdge) {
        band(outer, n0, n1, side);
    }
}

/** A flat pane over an outline at depth n. */
export function pane(outline: Pt[], n: number, tri: Tri): void {
    faces(outline, null, n, tri);
}
