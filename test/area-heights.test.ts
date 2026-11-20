import assert from 'node:assert/strict';
import test from 'node:test';
import {
    aroundOutline,
    cornerRise,
    hasHeights,
    heightRange,
    heightsInsert,
    heightsRemove,
    heightsSet,
    innerPoints,
    raisedAround,
} from '../frontend/vendor-ext/area-heights';

type P = [number, number];

const rect: P[] = [
    [0, 0],
    [10, 0],
    [10, 6],
    [0, 6],
];

test('area heights: the corners give their height, the edges run straight between them, a plane stays a plane', () => {
    // a lawn rising from the street (z = 6, south) to the hill (z = 0, north): 2.8 m
    const h = [2.8, 2.8, 0, 0];
    assert.equal(cornerRise(rect, h, 0, 0), 2.8);
    assert.equal(cornerRise(rect, h, 10, 6), 0);
    // on an edge: halfway
    assert.ok(Math.abs(cornerRise(rect, h, 10, 3) - 1.4) < 1e-9);
    // inside a plane: exact everywhere
    for (const [x, z] of [
        [5, 3],
        [2, 1],
        [8.5, 5.2],
    ] as P[]) {
        assert.ok(Math.abs(cornerRise(rect, h, x, z) - 2.8 * (1 - z / 6)) < 1e-9, `${x} ${z}`);
    }
    // turned the other way round (clockwise) it is the same surface
    const cw = [...rect].reverse();
    assert.ok(Math.abs(cornerRise(cw, [...h].reverse(), 5, 1.5) - 2.1) < 1e-9);
    // no heights: flat
    assert.equal(cornerRise(rect, null, 5, 3), 0);
    assert.equal(cornerRise(rect, [0, null, 0, 0], 5, 3), 0);
});

test('area heights: one corner raised bends the surface smoothly, within the corners and on a concave outline too', () => {
    const h = [0, 0, 2, 0];
    const mid = cornerRise(rect, h, 5, 3);
    assert.ok(mid > 0.2 && mid < 1.2, `${mid}`);
    // nearer the raised corner it is higher
    assert.ok(cornerRise(rect, h, 8, 5) > mid);
    // an L: everything inside stays within the corners' range
    const l: P[] = [
        [0, 0],
        [6, 0],
        [6, 2],
        [2, 2],
        [2, 6],
        [0, 6],
    ];
    const lh = [0, 1, 1, 1, 3, 3];
    for (let x = 0.1; x < 6; x += 0.37) {
        for (let z = 0.1; z < 6; z += 0.41) {
            if (x > 2 && z > 2) {
                continue;
            }
            const y = cornerRise(l, lh, x, z);
            assert.ok(Number.isFinite(y) && y >= 0 && y <= 3, `${x} ${z}: ${y}`);
        }
    }
});

test('area heights: points inside for the surface to bend, not near the edges nor in holes, at most max', () => {
    const pts = innerPoints(rect);
    assert.ok(pts.length > 40);
    for (const [x, z] of pts) {
        assert.ok(x > 0.2 && x < 9.8 && z > 0.2 && z < 5.8);
    }
    const hole: P[] = [
        [3, 2],
        [6, 2],
        [6, 4],
        [3, 4],
    ];
    assert.ok(innerPoints(rect, [hole]).every(([x, z]) => !(x > 3 && x < 6 && z > 2 && z < 4)));
    // a big field stays bounded
    const big: P[] = [
        [0, 0],
        [80, 0],
        [80, 60],
        [0, 60],
    ];
    assert.ok(innerPoints(big).length <= 400);
});

test('area heights: a floor stands in the ground where a garden lies clearly higher beside it', () => {
    const house: P[] = [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
    ];
    // every probe lies outside the house, 0.3 m away
    for (const [x, z] of aroundOutline(house)) {
        const d = Math.min(Math.abs(x), Math.abs(x - 10), Math.abs(z), Math.abs(z - 8));
        assert.ok(!(x > 0 && x < 10 && z > 0 && z < 8), `${x} ${z}`);
        assert.ok(Math.abs(d - 0.3) < 1e-9 || x < 0 || x > 10 || z < 0 || z > 8);
    }
    const ground = () => -0.2;
    // a lawn at the usual level, a terrace: not in the ground
    assert.equal(
        raisedAround(house, () => -0.05, ground),
        false,
    );
    // the hill north of the house at 2.8 m
    assert.equal(
        raisedAround(house, ([, z]) => (z < 0 ? 2.8 : null), ground),
        true,
    );
});

test('area heights: corners put in or taken out keep the heights in step', () => {
    assert.equal(hasHeights(null), false);
    assert.equal(hasHeights([0, null, 0]), false);
    assert.deepEqual(heightRange([1, -0.5, null]), [-0.5, 1]);
    // halfway between corner 1 and 2
    assert.deepEqual(heightsInsert([0, 2, 1, 0], 4, 1), [0, 2, 1.5, 1, 0]);
    // behind the last corner: between it and the first
    assert.deepEqual(heightsInsert([1, 0, 0, 3], 4, 3), [1, 0, 0, 3, 2]);
    assert.equal(heightsInsert(null, 4, 1), null);
    assert.deepEqual(heightsRemove([0, 2, 1, 0], 4, 1), [0, 1, 0]);
    assert.equal(heightsRemove([0, 2, 0, 0], 4, 1), null);
    assert.deepEqual(heightsSet(null, 4, 2, 1.25), [0, 0, 1.25, 0]);
    assert.equal(heightsSet([0, 0, 1.25, 0], 4, 2, 0), null);
    // a shorter list (corners added without heights) is filled up
    assert.deepEqual(heightsSet([1], 3, 2, 2), [1, 0, 2]);
});
