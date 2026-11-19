import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRainTank, rainTankCapacity, rainTankFill, rainTankKind } from '../frontend/vendor-ext/rain-tank';

test('a rainwater tank: its capacity from its size, its fill from the level sensor in any unit', () => {
    assert.equal(rainTankKind('cistern'), 'cistern');
    assert.equal(rainTankKind(null), 'barrel');
    // a 0.7 m wide, 1 m high barrel holds about 365 l
    assert.equal(rainTankCapacity('barrel', 0.7, 0.7, 1), 366);
    assert.equal(rainTankCapacity('cistern', 2, 1.5, 1.5), 4275);
    assert.equal(rainTankFill('40', '%', 300, 1), 0.4);
    assert.equal(rainTankFill('150', 'l', 300, 1), 0.5);
    assert.equal(rainTankFill('1,5', 'm³', 3000, 1.5), 0.5);
    assert.equal(rainTankFill('75', 'cm', 300, 1.5), 0.5);
    assert.equal(rainTankFill('0.25', 'm', 300, 1), 0.25);
    // without a unit: a fraction or %
    assert.equal(rainTankFill('0.3', '', 300, 1), 0.3);
    assert.equal(rainTankFill('30', '', 300, 1), 0.3);
    // over full, below empty, no number
    assert.equal(rainTankFill('420', 'l', 300, 1), 1);
    assert.equal(rainTankFill('-3', '%', 300, 1), 0);
    assert.equal(rainTankFill('unavailable', '%', 300, 1), null);
    assert.equal(rainTankFill('', '%', 300, 1), null);
});

test('a barrel stands on the ground, a cistern lies in it', () => {
    const barrel = buildRainTank('barrel', 0.7, 0.7, 1, 0.5);
    assert.ok((barrel.userData.inlet as number) > 1);
    const cistern = buildRainTank('cistern', 2.2, 1.6, 1.5, 0.5);
    assert.ok((cistern.userData.inlet as number) < 0.1);
    // without a sensor no water is drawn
    assert.ok(buildRainTank('barrel', 0.7, 0.7, 1, null).children.length < barrel.children.length);
});
