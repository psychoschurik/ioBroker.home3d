import assert from 'node:assert/strict';
import test from 'node:test';
import { cornerBathtub, cornerTub, cornerTubSymbol, roundInset } from '../frontend/vendor-ext/corner-tub';
import type { ItemDraw } from '../frontend/vendor-ext/house-items';

type P = [number, number];

/** Whether p lies inside the polygon (ray casting). */
function inside([x, z]: P, poly: readonly P[]): boolean {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i];
        const [xj, zj] = poly[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
            hit = !hit;
        }
    }
    return hit;
}

/** The distance of p to the polygon's edge. */
function edgeDistance([x, z]: P, poly: readonly P[]): number {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const [ax, az] = poly[i];
        const [bx, bz] = poly[(i + 1) % poly.length];
        const len2 = (bx - ax) ** 2 + (bz - az) ** 2;
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / len2));
        best = Math.min(best, Math.hypot(x - (ax + t * (bx - ax)), z - (az + t * (bz - az))));
    }
    return best;
}

test('corner bathtub: two sides along the walls, the front cut off, a rounded basin inside the rim', () => {
    const { outline, basin, tap, spout } = cornerTub(1.4, 1.4);
    // the walls' corner first, the cut front from the right end to the front end
    assert.deepEqual(outline[0], [-0.7, -0.7]);
    assert.equal(outline.length, 5);
    for (const [x, z] of outline) {
        assert.ok(Math.abs(x) <= 0.7 + 1e-9 && Math.abs(z) <= 0.7 + 1e-9);
    }
    assert.ok(basin && basin.length > 20, 'rounded: arcs at its corners');
    // the rim is 8 cm everywhere, at least
    for (const p of basin) {
        assert.ok(inside(p, outline), `inside the tub: ${p}`);
        assert.ok(edgeDistance(p, outline) >= 0.08 - 1e-6, `the rim at ${p}`);
    }
    // the tap stands on the deck in the corner, the spout's water falls into the basin
    assert.ok(inside(tap, outline) && !inside(tap, basin));
    assert.ok(edgeDistance(tap, basin) > 0.04, 'the tap clear of the basin');
    assert.ok(inside(spout, basin) && edgeDistance(spout, basin) > 0.03, `the water into the basin: ${spout}`);
});

test('corner bathtub: an uneven or small box still gives a tub, a basin only where there is room for one', () => {
    for (const [w, d] of [
        [1.6, 1.0],
        [1.0, 1.6],
        [1.2, 1.2],
    ]) {
        const { outline, basin, spout } = cornerTub(w, d);
        assert.ok(basin, `${w} × ${d}`);
        for (const p of basin) {
            assert.ok(inside(p, outline));
        }
        assert.ok(inside(spout, basin), `${w} × ${d}: water in the basin`);
    }
    const tiny = cornerTub(0.3, 0.3);
    assert.equal(tiny.basin, null);
    assert.equal(tiny.outline.length, 5);
});

test('corner bathtub: an inset keeps its corners rounded by r, null when a side would vanish', () => {
    const square: P[] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
    ];
    const near = (pts: P[] | null, want: P[]): boolean =>
        !!pts && pts.length === want.length && pts.every(([x, z], i) => Math.hypot(x - want[i][0], z - want[i][1]) < 1e-9);
    assert.ok(
        near(roundInset(square, 0.1, 0), [
            [0.1, 0.1],
            [0.9, 0.1],
            [0.9, 0.9],
            [0.1, 0.9],
        ]),
    );
    // clockwise just the same
    const sharp = roundInset([...square].reverse(), 0.1, 0);
    assert.ok(sharp && sharp.every(([x, z]) => Math.abs(Math.abs(x - 0.5) - 0.4) < 1e-9 && Math.abs(Math.abs(z - 0.5) - 0.4) < 1e-9));
    const round = roundInset(square, 0.1, 0.2);
    assert.ok(round);
    for (const [x, z] of round) {
        assert.ok(x >= 0.1 - 1e-9 && x <= 0.9 + 1e-9 && z >= 0.1 - 1e-9 && z <= 0.9 + 1e-9);
    }
    // the corners are cut: no point near (0.1, 0.1)
    assert.ok(round.every(([x, z]) => Math.hypot(x - 0.1, z - 0.1) > 0.05));
    assert.equal(roundInset(square, 0.6, 0), null);
});

test('corner bathtub: drawn within its box, the rim open over the basin; the plan symbol too', () => {
    const prisms: { pts: P[]; y0: number; y1: number; holes: P[][] }[] = [];
    const b: ItemDraw = {
        box: () => undefined,
        cyl: () => undefined,
        seg: () => undefined,
        prism: (pts, y0, y1, _side, _top, _edges, holes = []) => {
            prisms.push({ pts, y0, y1, holes });
        },
    };
    const c = { white: 1, whiteTop: 2, metal: 3, glass: 4 };
    cornerBathtub(b, c, { furn: null, faint: null, glow: null } as never, 1.4, 1.4, 0.58);
    for (const p of prisms) {
        assert.ok(p.y0 >= 0 && p.y1 <= 0.58 + 0.12);
        for (const [x, z] of p.pts) {
            assert.ok(Math.abs(x) <= 0.7 + 1e-9 && Math.abs(z) <= 0.7 + 1e-9);
        }
    }
    const rim = prisms.find(p => p.holes.length === 1);
    assert.ok(rim && rim.y1 === 0.58, 'the rim up to the top, open over the basin');
    const lines: number[][] = [];
    cornerTubSymbol(1.4, 1.4, {
        rect: (x0, z0, x1, z1) => lines.push([x0, z0, x1, z1]),
        line: (x0, z0, x1, z1) => lines.push([x0, z0, x1, z1]),
    });
    assert.ok(lines.length > 25);
    assert.ok(lines.flat().every(v => Math.abs(v) <= 0.7 + 1e-9));
});
