import assert from 'node:assert/strict';
import test from 'node:test';
import { chainPoints, chainShape } from '../frontend/vendor-ext/anchor';

test('the chain hangs straight down while it is shorter than the drop to the seabed', () => {
    const s = chainShape(3, 5, null);
    assert.equal(s.ground, false);
    assert.equal(s.reach, 0);
    assert.deepEqual(chainPoints(s, 3, 5).at(-1), [0, -3]);
});

test('on the ground the chain is a catenary down to the touchdown and lies on the seabed up to the anchor', () => {
    const length = 30;
    const drop = 6;
    const s = chainShape(length, drop, null);
    assert.equal(s.ground, true);
    // between straight down and just lifting off
    assert.ok(s.reach > length - drop && s.reach < Math.sqrt(length * length - drop * drop));
    // the hanging part ends on the seabed, and its length plus the lying part is the whole chain
    assert.ok(Math.abs(s.a * (Math.cosh(s.xs / s.a) - 1) - drop) < 1e-6);
    assert.ok(Math.abs(s.s + (s.reach - s.xs) - length) < 1e-6);
    const pts = chainPoints(s, length, drop);
    assert.deepEqual(pts[0].map(v => Math.round(v * 1e6) / 1e6), [0, 0]);
    const [h, v] = pts.at(-1)!;
    assert.ok(Math.abs(h - s.reach) < 1e-9 && v === -drop);
    // it only goes down and forward
    for (let i = 1; i < pts.length; i++) {
        assert.ok(pts[i][0] >= pts[i - 1][0] - 1e-9 && pts[i][1] <= pts[i - 1][1] + 1e-9);
    }
});

test('a measured distance to the anchor tightens the chain, within what the chain can reach', () => {
    const slack = chainShape(30, 6, 24.5);
    assert.ok(Math.abs(slack.reach - 24.5) < 1e-6);
    const taut = chainShape(30, 6, 100);
    assert.ok(taut.reach < Math.sqrt(30 * 30 - 36) && taut.reach > 27);
    assert.ok(Math.abs(chainShape(30, 6, 1).reach - 24) < 1e-3);
});
