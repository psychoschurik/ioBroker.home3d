import assert from 'node:assert/strict';
import test from 'node:test';
import { AFTER_RAIN, BOW, bowCentre, rainbowStrength } from '../frontend/vendor-ext/rainbow';

test('a rainbow needs a low sun that shines, and rain', () => {
    // a low sun, a broken sky, rain: a rainbow
    assert.equal(rainbowStrength(15, 0.5, 0.6, null), 1);
    // the sun too high, under the horizon or unknown: none
    assert.equal(rainbowStrength(45, 0.5, 0.6, null), 0);
    assert.equal(rainbowStrength(-2, 0.5, 0.6, null), 0);
    assert.equal(rainbowStrength(null, 0.5, 0.6, null), 0);
    // the sun behind a closed cover: none
    assert.equal(rainbowStrength(15, 1, 0.6, null), 0);
    // no rain in this session: none
    assert.equal(rainbowStrength(15, 0.3, 0, null), 0);
});

test('after the rain the rainbow fades within ten minutes', () => {
    assert.equal(rainbowStrength(15, 0.3, 0, 0), 1);
    const half = rainbowStrength(15, 0.3, 0, AFTER_RAIN / 2);
    assert.ok(half > 0.3 && half < 0.7);
    assert.equal(rainbowStrength(15, 0.3, 0, AFTER_RAIN), 0);
});

test('the bow stands opposite the sun, its top just under the top edge of the picture', () => {
    // looking along the horizon: around the antisolar point
    assert.equal(bowCentre(10, 40), -10);
    // looking down: lowered
    assert.equal(bowCentre(10, 5), 5 - BOW - 2);
});
