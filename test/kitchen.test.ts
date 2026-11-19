import assert from 'node:assert/strict';
import test from 'node:test';
import { BREW_W, brewing, buildCoffeeMachine } from '../frontend/vendor-ext/kitchen';

const st = (state: string, attributes: Record<string, unknown> = {}): { state: string; attributes: Record<string, unknown> } => ({
    state,
    attributes,
});

test('a coffee machine brews while its socket is on or draws more than a standby', () => {
    assert.equal(brewing(undefined), false);
    // a switch
    assert.equal(brewing(st('on')), true);
    assert.equal(brewing(st('off')), false);
    assert.equal(brewing(st('true')), true);
    // the power of its socket
    assert.equal(brewing(st('1350', { unit_of_measurement: 'W' })), true);
    assert.equal(brewing(st('3.2', { unit_of_measurement: 'W' })), false);
    assert.equal(brewing(st(String(BREW_W), { unit_of_measurement: 'W' })), true);
    assert.equal(brewing(st('1,2', { unit_of_measurement: 'kW' })), true);
    assert.equal(brewing(st('0.01', { unit_of_measurement: 'kW' })), false);
    assert.equal(brewing(st('900', { device_class: 'power' })), true);
    assert.equal(brewing(st('unavailable', { unit_of_measurement: 'W' })), false);
});

test('the coffee machine has its cup at the front, where the steam rises', () => {
    const g = buildCoffeeMachine(0.28, 0.4, 0.38);
    const [x, y, z] = g.userData.cupTop as [number, number, number];
    assert.equal(x, 0);
    assert.ok(y > 0.05 && y < 0.38 * 0.6, `under the spout: ${y}`);
    assert.ok(z > 0, 'at the front (+z)');
    assert.ok(g.children.length >= 6);
});
