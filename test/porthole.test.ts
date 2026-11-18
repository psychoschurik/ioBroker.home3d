import assert from 'node:assert/strict';
import test from 'node:test';
import { insetOutline, pane, plate, roundedOutline, type Pt } from '../frontend/vendor-ext/porthole';

/** Area of an outline (positive: counter-clockwise). */
const area = (pts: Pt[]): number => pts.reduce((a, p, i) => a + (p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1]) / 2, 0);
/** Area of triangles in the plane of one depth. */
const flat = (tris: number[][][]): number =>
    tris.reduce((a, [p, q, r]) => a + Math.abs((q[0] - p[0]) * (r[2] - p[2]) - (r[0] - p[0]) * (q[2] - p[2])) / 2, 0);

test('a rounded outline: a circle when square, a slot with round ends when wide, counter-clockwise', () => {
    const circle = roundedOutline(0, 0.4, 0, 0.4);
    assert.ok(Math.abs(area(circle) - Math.PI * 0.04) < 0.002);
    const slot = roundedOutline(0, 0.8, 1, 1.3);
    // 0.5 × 0.3 rectangle plus a circle of 0.15
    assert.ok(Math.abs(area(slot) - (0.5 * 0.3 + Math.PI * 0.15 * 0.15)) < 0.003);
    for (let i = 0; i < slot.length; i++) {
        const p = slot[i];
        const q = slot[(i + 1) % slot.length];
        assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6, 'no repeated points');
    }
    const inner = insetOutline(0, 0.8, 1, 1.3, 0.05);
    assert.ok(area(inner) < area(slot) && area(inner) > 0);
});

test('a plate with a rounded hole covers the rectangle but the hole; the pane covers the hole', () => {
    const rect: Pt[] = [
        [0, 0],
        [0.5, 0],
        [0.5, 0.5],
        [0, 0.5],
    ];
    const hole = roundedOutline(0.05, 0.45, 0.05, 0.45);
    const face: number[][][] = [];
    const side: number[][][] = [];
    plate(rect, hole, -0.03, 0.03, (a, b, c) => face.push([a, b, c]), (a, b, c) => side.push([a, b, c]), false);
    const front = face.filter(t => t.every(p => p[1] === 0.03));
    assert.ok(Math.abs(flat(front) - (0.25 - area(hole))) < 1e-6);
    // the hole's edge: two triangles per segment, the outer edge left out
    assert.equal(side.length, hole.length * 2);
    const glass: number[][][] = [];
    pane(hole, 0, (a, b, c) => glass.push([a, b, c]));
    assert.ok(Math.abs(flat(glass) - area(hole)) < 1e-6);
});
