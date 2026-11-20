// The heights at the corners of an area outside (a lawn up a hill, a bank beside the drive): the surface runs
// between them. Pure (no three.js): the model, the editor and the 3D view use it alike.

type P = [number, number];

/** A corner's height over the area's level (m); missing or null counts as 0. */
function hOf(heights: readonly (number | null | undefined)[], i: number): number {
    const h = heights[i];
    return typeof h === 'number' && Number.isFinite(h) ? h : 0;
}

/** Whether an area has a corner raised or lowered at all. */
export function hasHeights(heights: readonly (number | null | undefined)[] | null | undefined): boolean {
    return !!heights && heights.some(h => typeof h === 'number' && Number.isFinite(h) && Math.abs(h) > 1e-9);
}

/** The lowest and the highest corner (m, 0 included: the level itself). */
export function heightRange(heights: readonly (number | null | undefined)[] | null | undefined): [number, number] {
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < (heights?.length ?? 0); i++) {
        const h = hOf(heights!, i);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
    }
    return [lo, hi];
}

/**
 * The rise of the surface at a point over the area's level: the corners' heights blended by mean value coordinates
 * (Hormann & Floater), smooth inside, straight along every edge, exactly the corner's height at a corner; a plane
 * stays a plane. Points outside are clamped to the corners' range.
 */
export function cornerRise(
    points: readonly P[],
    heights: readonly (number | null | undefined)[] | null | undefined,
    x: number,
    z: number,
): number {
    const n = points.length;
    if (!heights || n < 3 || !hasHeights(heights)) {
        return 0;
    }
    const sx: number[] = [];
    const sz: number[] = [];
    const r: number[] = [];
    for (let i = 0; i < n; i++) {
        sx.push(points[i][0] - x);
        sz.push(points[i][1] - z);
        r.push(Math.hypot(sx[i], sz[i]));
        // on a corner
        if (r[i] < 1e-7) {
            return hOf(heights, i);
        }
    }
    // tan(α/2) of the angle each edge spans as seen from the point, signed (a concave outline)
    const tanHalf: number[] = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const cross = sx[i] * sz[j] - sx[j] * sz[i];
        const dot = sx[i] * sx[j] + sz[i] * sz[j];
        if (Math.abs(cross) < 1e-9 * r[i] * r[j]) {
            if (dot < 0) {
                // on this edge: straight between its two corners
                const t = r[i] / (r[i] + r[j]);
                return hOf(heights, i) * (1 - t) + hOf(heights, j) * t;
            }
            tanHalf.push(0);
            continue;
        }
        tanHalf.push((r[i] * r[j] - dot) / cross);
    }
    let sw = 0;
    let sh = 0;
    for (let i = 0; i < n; i++) {
        const w = (tanHalf[(i - 1 + n) % n] + tanHalf[i]) / r[i];
        sw += w;
        sh += w * hOf(heights, i);
    }
    const [lo, hi] = heightRange(heights);
    if (!Number.isFinite(sh / sw) || Math.abs(sw) < 1e-12) {
        return 0;
    }
    return Math.min(hi, Math.max(lo, sh / sw));
}

/** Point in polygon (even-odd). */
function inside(p: P, poly: readonly P[]): boolean {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i];
        const [xj, zj] = poly[j];
        if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) {
            c = !c;
        }
    }
    return c;
}

/** Distance from a point to a closed ring's edges. */
function edgeDist(p: P, ring: readonly P[]): number {
    let d = Infinity;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const ex = b[0] - a[0];
        const ez = b[1] - a[1];
        const l2 = ex * ex + ez * ez;
        const t = l2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2)) : 0;
        d = Math.min(d, Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t));
    }
    return d;
}

/**
 * Points inside an area on a grid, for its surface to bend between the corners (the triangulation takes them as
 * points of its own): at most `max`, none near an edge or in a hole.
 */
export function innerPoints(poly: readonly P[], holes: readonly (readonly P[])[] = [], max = 400): P[] {
    if (poly.length < 3) {
        return [];
    }
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const [x, z] of poly) {
        x0 = Math.min(x0, x);
        z0 = Math.min(z0, z);
        x1 = Math.max(x1, x);
        z1 = Math.max(z1, z);
    }
    const area = (x1 - x0) * (z1 - z0);
    const step = Math.max(0.75, Math.sqrt(area / max));
    const out: P[] = [];
    for (let x = x0 + step / 2; x < x1; x += step) {
        for (let z = z0 + step / 2; z < z1; z += step) {
            const p: P = [x, z];
            if (!inside(p, poly) || edgeDist(p, poly) < step * 0.3) {
                continue;
            }
            if (holes.some(h => h.length >= 3 && (inside(p, h) || edgeDist(p, h) < step * 0.3))) {
                continue;
            }
            out.push(p);
        }
    }
    return out.slice(0, max);
}

/**
 * Points just outside a floor's outline (every half metre along its edges, `out` metres away), for the earth to look
 * at the surface of the areas lying there.
 */
export function aroundOutline(outline: readonly P[], out = 0.3, step = 0.5): P[] {
    const pts: P[] = [];
    for (let i = 0; i < outline.length; i++) {
        const a = outline[i];
        const c = outline[(i + 1) % outline.length];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (len < 1e-4) {
            continue;
        }
        const ax: P = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
        let n: P = [ax[1], -ax[0]];
        const mid: P = [(a[0] + c[0]) / 2 + n[0] * 0.05, (a[1] + c[1]) / 2 + n[1] * 0.05];
        if (inside(mid, outline)) {
            n = [-n[0], -n[1]];
        }
        const k = Math.max(1, Math.ceil(len / step));
        for (let j = 0; j <= k; j++) {
            const s = (len * j) / k;
            pts.push([a[0] + ax[0] * s + n[0] * out, a[1] + ax[1] * s + n[1] * out]);
        }
    }
    return pts;
}

/**
 * Whether a floor stands in the ground somewhere because an area outside lies clearly higher (half a metre) than
 * the plain ground beside it (a garden up a hill against the house, not a terrace): `cover` is the surface there
 * (null: none), `ground` the plain ground, both in the floor's heights.
 */
export function raisedAround(outline: readonly P[], cover: (p: P) => number | null, ground: (p: P) => number): boolean {
    return aroundOutline(outline).some(p => {
        const c = cover(p);
        return c !== null && c > -0.15 && c > ground(p) + 0.5;
    });
}

/** The heights after a corner was put in behind corner `i` (halfway along its edge): its height halfway too. */
export function heightsInsert(
    heights: readonly (number | null)[] | null | undefined,
    n: number,
    i: number,
): (number | null)[] | null {
    if (!hasHeights(heights)) {
        return null;
    }
    const h = Array.from({ length: n }, (_, k) => hOf(heights!, k));
    const mid = Math.round(((h[i] + h[(i + 1) % n]) / 2) * 1000) / 1000;
    h.splice(i + 1, 0, mid);
    return h;
}

/** The heights after corner `i` was taken out. */
export function heightsRemove(
    heights: readonly (number | null)[] | null | undefined,
    n: number,
    i: number,
): (number | null)[] | null {
    if (!hasHeights(heights)) {
        return null;
    }
    const h = Array.from({ length: n }, (_, k) => hOf(heights!, k));
    h.splice(i, 1);
    return hasHeights(h) ? h : null;
}

/** The heights with corner `i` set to `v` (null when every corner is back at the level). */
export function heightsSet(
    heights: readonly (number | null)[] | null | undefined,
    n: number,
    i: number,
    v: number,
): (number | null)[] | null {
    const h = Array.from({ length: n }, (_, k) => (heights ? hOf(heights, k) : 0));
    h[i] = Math.min(20, Math.max(-20, Math.round(v * 1000) / 1000));
    return hasHeights(h) ? h : null;
}
