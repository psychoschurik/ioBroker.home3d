import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultLightY, isGear, lightOn, tankFill, tankWarn } from '../frontend/vendor-ext/boat-kinds';
import { wakeStrength } from '../frontend/vendor-ext/sea';

test('a tank reads its fill in % or as a fraction and warns when a supply runs out or a holding tank fills up', () => {
    assert.equal(tankFill(45, '%'), 0.45);
    assert.equal(tankFill(0.3, ''), 0.3);
    assert.equal(tankFill(80, ''), 0.8);
    assert.equal(tankFill(120, '%'), 1);
    assert.equal(tankWarn('water', 0.15), true);
    assert.equal(tankWarn('fuel', 0.45), false);
    assert.equal(tankWarn('black', 0.9), true);
    assert.equal(tankWarn('grey', 0.1), false);
});

test('navigation lights: on from a switch, the anchor light at the masthead unless set', () => {
    assert.equal(lightOn('on'), 1);
    assert.equal(lightOn('true'), 1);
    assert.equal(lightOn('off'), 0);
    assert.equal(lightOn(undefined), 0);
    assert.ok(defaultLightY('anchor') > defaultLightY('steaming'));
    assert.ok(defaultLightY('stern') < 2);
    assert.equal(isGear('rudder'), true);
    assert.equal(isGear('sofa'), false);
});

test('the wake starts at about half a knot and is full at about seven', () => {
    assert.equal(wakeStrength(undefined), 0);
    assert.equal(wakeStrength(0.1), 0);
    assert.ok(wakeStrength(1) > 0 && wakeStrength(1) < 0.5);
    assert.equal(wakeStrength(10), 1);
});
