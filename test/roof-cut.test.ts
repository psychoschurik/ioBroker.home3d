import assert from 'node:assert/strict';
import test from 'node:test';
import { cheekFoot, cheekHigh, cheekPieces, cutHole } from '../frontend/vendor-ext/roof-cut';

// a slope falling to the south: 3 m over the deck at z = 0, 0.5 m at z = 5
const slope = (_x: number, z: number): number => 3 - z / 2;

test('roof cut: the cheek follows the slope, the parapet in front is too low to drop the railing', () => {
    const side = cheekPieces([4, 0], [4, 5], 0, 1, slope);
    assert.equal(side.length, 5);
    assert.equal(side[0].ya, 3);
    assert.equal(side[4].yb, 0.5);
    // a railing of 1 m: the cheek is lower than that near the eaves
    assert.equal(cheekHigh(side, 0, 1, 5), false);
    const back = cheekPieces([0, 1], [4, 1], 0, 1, slope);
    assert.equal(cheekHigh(back, 0, 1, 4), true);
    // no roof: nothing to build
    assert.deepEqual(cheekPieces([0, 0], [4, 0], 0, 1, null), []);
    assert.deepEqual(
        cheekPieces([0, 0], [4, 0], 0, 1, () => null),
        [],
    );
});

test('roof cut: the wall stands outside the edge, the hole spans the corners', () => {
    // a counter-clockwise outline in (x, z): its edge from (0, 0) to (4, 0) has its outside at −z
    assert.deepEqual(cheekFoot([0, 0], [4, 0], 0.2), [
        [0, 0],
        [0, -0.2],
        [4, -0.2],
        [4, 0],
    ]);
    assert.deepEqual(
        cutHole([
            [3, 1],
            [7, 1],
            [7, 4],
            [3, 4],
        ]),
        { u0: 3, u1: 7, v0: 1, v1: 4 },
    );
});
