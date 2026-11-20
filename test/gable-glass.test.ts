import assert from 'node:assert/strict';
import test from 'node:test';
import { glassStrips, glazedTops, roofTops, topAtX } from '../frontend/vendor-ext/gable-glass';

// a gable over a window 2 m wide: the ridge (3.5 m) above its middle, 2.5 m at its ends
const gable = (s: number): number => 3.5 - Math.abs(s - 1);

test('gable glass: the roof is sampled along the window, glass only where there is room above it', () => {
    const tops = roofTops(2, gable);
    assert.equal(tops.length, 11);
    assert.equal(tops[0], 2.5);
    assert.equal(tops[5], 3.5);
    assert.equal(tops[10], 2.5);
    assert.equal(topAtX(tops, 2, 0.5), 3);
    assert.deepEqual(glazedTops(tops, 2.2), tops);
    // the roof hardly above the window: nothing to glaze
    assert.equal(
        glazedTops(
            roofTops(2, () => 2.3),
            2.2,
        ),
        null,
    );
    assert.equal(glazedTops(null, 2), null);
});

test('gable glass: the strips fill from the transom up under the frame along the slope', () => {
    const tops = roofTops(2, gable);
    const strips = glassStrips(tops, 2, 2.3, 0.06);
    assert.ok(strips.length >= 9);
    assert.ok(Math.abs(strips[0].x0 - 0.06) < 1e-9);
    assert.ok(Math.abs(strips[strips.length - 1].x1 - 1.94) < 1e-9);
    for (const g of strips) {
        assert.equal(g.y0, 2.3);
        assert.ok(g.ya <= topAtX(tops, 2, g.x0) - 0.06 + 1e-9 && g.ya >= 2.3);
    }
    // the roof down to the transom: no glass
    assert.deepEqual(
        glassStrips(
            roofTops(2, () => 2.3),
            2,
            2.3,
            0.06,
        ),
        [],
    );
});
